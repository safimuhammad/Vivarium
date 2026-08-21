/**
 * Pure pixel preflight gates for the R5 source-bound regional art workflow.
 *
 * These metrics reject known structural failure modes. They deliberately do not
 * claim aesthetic or semantic recognition; original-resolution blind review is
 * still the release authority.
 */

import { createHash } from "node:crypto";
import sharp from "sharp";

export const R5_GUIDE_SOURCES = Object.freeze({
  regionKits: Object.freeze({
    path: "scratchpad/2d-production-art/source/imagegen-concepts/region-kits-imagegen-guide.png",
    width: 1536,
    height: 1024,
    sha256: "2d4aa7c04e7af2c123a34f854ae896eef5babf7e56344a7750014adf07335913",
    repositoryVersioned: false,
  }),
  homeRuin: Object.freeze({
    path: "scratchpad/2d-production-art/source/imagegen-concepts/home-ruin-imagegen-guide.png",
    width: 1536,
    height: 1024,
    sha256: "a8d83b04d092cfd03400c7541ee6003b73ed0426270a1a5b7b0170966c411b48",
    repositoryVersioned: false,
  }),
});

export const R5_FORBIDDEN_GUIDE_CROPS = Object.freeze([
  "spring-terraces/willow[3]",
  "spring-terraces/reed-bed[2]",
  "spring-terraces/reed-bed[3]",
  "dry-scrub/sun-rock[2]",
  "dry-scrub/sun-rock[3]",
  "dry-scrub/thorn[0]",
  "dry-scrub/thorn[1]",
  "dry-scrub/thorn[2]",
  "dry-scrub/thorn[3]",
  "neutral-temperate/soft-grass[0]",
  "neutral-temperate/soft-grass[1]",
  "neutral-temperate/soft-grass[2]",
  "neutral-temperate/soft-grass[3]",
]);

export const R5_REQUIRED_HUMAN_WITNESS_ROLES = Object.freeze([
  "route-entry",
  "defining-landmark",
  "shelter-door",
]);

const R5_ASH_SOURCE_ROLE_ORDER = Object.freeze([
  "pylon-lattice",
  "cable-run",
  "containment-relief",
  "service-slab",
]);

export function validateAshSourceRoleOrder(contract, layers) {
  const declaredRoles = Array.isArray(contract?.roleInventory) ? contract.roleInventory : [];
  const decodedRoles = Array.isArray(layers) ? layers.map((layer) => layer?.role) : [];
  const exact = (roles) => roles.length === R5_ASH_SOURCE_ROLE_ORDER.length
    && R5_ASH_SOURCE_ROLE_ORDER.every((role, index) => roles[index] === role);
  return exact(declaredRoles) && exact(decodedRoles)
    ? []
    : ["ash-source-inventory-mismatch: oracle-owned pylon/cable/containment/service role order required"];
}

// Task 2 replaces these empty authority registries with reviewed, hash-pinned
// R5 source rows. Candidate evidence can reference a row but cannot define one.
function assertPlainAuthorityData(value, seen = new Set()) {
  if (value === null || typeof value === "undefined"
      || typeof value === "string" || typeof value === "number"
      || typeof value === "boolean" || typeof value === "bigint") return;
  if (typeof value !== "object" || seen.has(value)) {
    if (seen.has(value)) return;
    throw new TypeError("trusted source registries accept only plain authority data");
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("trusted source registries accept only plain authority data");
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("trusted source registries accept only plain authority data");
    }
    assertPlainAuthorityData(descriptor.value, seen);
  }
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

function isDeepFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Reflect.ownKeys(value).every((key) => isDeepFrozen(value[key], seen));
}

export function createTrustedSourceRegistry(entries = []) {
  const registry = Object.create(null);
  for (const [key, value] of entries) {
    assertPlainAuthorityData(value);
    registry[key] = deepFreeze(value);
  }
  return Object.freeze(registry);
}

const closedRegistry = createTrustedSourceRegistry;

function ownRegistryRow(registry, key) {
  return typeof key === "string" && Object.hasOwn(registry, key) ? registry[key] : null;
}

export const R5_TRUSTED_SCENERY_SOURCE_CONTRACTS = closedRegistry();
export const R5_TRUSTED_ASH_SOURCE_CONTRACTS = closedRegistry();
export const R5_TRUSTED_LIFECYCLE_SOURCE_CONTRACTS = closedRegistry();
export const R5_TRUSTED_TERRAIN_SOURCE_CONTRACTS = closedRegistry();
export const R5_TRUSTED_HOME_ACTOR_SOURCE_CONTRACTS = closedRegistry();

const SYNTHETIC_SCENERY_SOURCE_CONTRACT = Object.freeze({
  assetId: "r5-oracle-synthetic-scenery-atlas",
  pngSha256: "168b4e67f8da2c85f2a1a4c446d4f97a9ae998e06e0d7592ce41e07eb016513b",
  width: 128,
  height: 64,
  sceneWidth: 96,
  sceneHeight: 72,
  baseRgbaSha256: "52a891f03f648928ff6c8e888ac9790d43ad43c4ec4d5a35b505e866c874edcf",
  sceneRgbaSha256: "5943f3a9b753bdd6a7147b4d039732f106728f9d3bb7db1c9e435026539a2163",
  layerInventory: Object.freeze(["route", "landmark", "support-a", "support-b"]),
  roleInventory: Object.freeze(["route", "landmark", "support", "support"]),
  layers: Object.freeze([
    Object.freeze({ id: "route", role: "route", rect: Object.freeze({ x: 0, y: 0, width: 96, height: 8 }), destination: Object.freeze({ x: 0, y: 53 }), rgbaSha256: "c498abd7a0cd7a629bf5bea6f5d338a222014043c1a67eece7c9a7467ddf2594" }),
    Object.freeze({ id: "landmark", role: "landmark", rect: Object.freeze({ x: 0, y: 16, width: 28, height: 28 }), destination: Object.freeze({ x: 36, y: 18 }), rgbaSha256: "8d1a3bfdc2655e8124ca9a678ba7b3e5a9692e82c3d867f7a4163ce49cf189d8" }),
    Object.freeze({ id: "support-a", role: "support", rect: Object.freeze({ x: 32, y: 16, width: 10, height: 12 }), destination: Object.freeze({ x: 26, y: 28 }), rgbaSha256: "cbb3d63376bcf69c3cb8d1b5154e0acca95a09bd8307b872246db2088e09a061" }),
    Object.freeze({ id: "support-b", role: "support", rect: Object.freeze({ x: 48, y: 16, width: 9, height: 12 }), destination: Object.freeze({ x: 58, y: 43 }), rgbaSha256: "33ef4dd179e8ac376a6a2f8b1c0608598b78c0a6a638f08a846d505d08f442c1" }),
  ]),
});

const SYNTHETIC_ASH_SOURCE_CONTRACT = Object.freeze({
  assetId: "r5-oracle-synthetic-ash-atlas",
  pngSha256: "53549a5ba91a7900447f2999225fa3da97a095d3a8a8e2c4df5729c4d4622202",
  width: 576,
  height: 112,
  sceneWidth: 144,
  sceneHeight: 112,
  baseRgbaSha256: "7a11660e361ca206327b4dd8593e8dbb0d45b353224c5074a20274d51cd5e0d5",
  sceneRgbaSha256: "5d11521ec229170467f45e98d93fa0c03361cdd47d679ee0278a8c3aba1db78e",
  layerInventory: Object.freeze(["pylon", "cable", "relief", "service"]),
  roleInventory: Object.freeze(["pylon-lattice", "cable-run", "containment-relief", "service-slab"]),
  reliefRgbaSha256: "77e69d8cb67ee57319923b814bc48606cdca3a6c7fd02468fec626eea742d80c",
  layers: Object.freeze([
    Object.freeze({ id: "pylon", role: "pylon-lattice", rect: Object.freeze({ x: 0, y: 0, width: 144, height: 112 }), destination: Object.freeze({ x: 0, y: 0 }), rgbaSha256: "8a12b2976e2893465dd17b5595c1cc8041f4c5a2ba5cc6eb45717e2b53d55621" }),
    Object.freeze({ id: "cable", role: "cable-run", rect: Object.freeze({ x: 144, y: 0, width: 144, height: 112 }), destination: Object.freeze({ x: 0, y: 0 }), rgbaSha256: "76e257d8968ec881dd8f104a1f54ad54ee5dd4fc11c28387d8294fb9256aff38" }),
    Object.freeze({ id: "relief", role: "containment-relief", rect: Object.freeze({ x: 288, y: 0, width: 144, height: 112 }), destination: Object.freeze({ x: 0, y: 0 }), rgbaSha256: "77e69d8cb67ee57319923b814bc48606cdca3a6c7fd02468fec626eea742d80c" }),
    Object.freeze({ id: "service", role: "service-slab", rect: Object.freeze({ x: 432, y: 0, width: 144, height: 112 }), destination: Object.freeze({ x: 0, y: 0 }), rgbaSha256: "c192ed163d0df6a28660fad82d7620ac59d275bf3048d869b84c862efad29419" }),
  ]),
});

const SYNTHETIC_LIFECYCLE_SOURCE_CONTRACT = Object.freeze({
  assetId: "r5-oracle-synthetic-lifecycle-atlas",
  pngSha256: "9d2a003b60cf7576fa38ccbc43590c0252adab7ded0f224dd4f82a9fc1439731",
  width: 1920,
  height: 160,
  sceneWidth: 192,
  sceneHeight: 160,
  layerInventory: Object.freeze(["terrain", "base-a", "base-b", "home", "warm-overlay", "hoard-overlay", "warm-a", "warm-b", "hoard-a", "hoard-b"]),
  roleInventory: Object.freeze(["terrain", "base-a", "base-b", "home-actor", "warm-overlay", "hoard-overlay", "warm-a", "warm-b", "hoard-a", "hoard-b"]),
  terrainAuthorityRowId: "synthetic-terrain",
  homeActorAuthorityRowId: "synthetic-home-actor",
  terrainPreviewRect: Object.freeze({ x: 0, y: 0, width: 192, height: 160 }),
  composedCrop: Object.freeze({ x: 128, y: 160, width: 192, height: 160 }),
  composedSceneRgbaSha256: "84e7aacf70f20bb32395f0a71892a4dc47e0647db2811028e6ffc2bfbdf60291",
  composedBaseRole: "base-a",
  layers: Object.freeze([
    Object.freeze({ id: "terrain", role: "terrain", rect: Object.freeze({ x: 0, y: 0, width: 192, height: 160 }), destination: Object.freeze({ x: 0, y: 0 }), rgbaSha256: "2fdddc6d67b459f95ac70b1b6df1b9a6041ed1e0ec713f68b97707c0cc629d87" }),
    Object.freeze({ id: "base-a", role: "base-a", rect: Object.freeze({ x: 192, y: 0, width: 192, height: 160 }), destination: Object.freeze({ x: 0, y: 0 }), rgbaSha256: "62c95657a0ef04f11e3c41ebd434ff29f6a4ed7ddf800f288cb36073eb2e011e" }),
    Object.freeze({ id: "base-b", role: "base-b", rect: Object.freeze({ x: 384, y: 0, width: 192, height: 160 }), destination: Object.freeze({ x: 0, y: 0 }), rgbaSha256: "b4f4b77cdb5ed58b985a51fddf7724f0807ce95314efe759b3bb323e944dd756" }),
    Object.freeze({ id: "home", role: "home-actor", rect: Object.freeze({ x: 576, y: 0, width: 192, height: 160 }), destination: Object.freeze({ x: 0, y: 0 }), rgbaSha256: "7c64bd8cb8bdd10708a0ca48d72002accc69668cb7e2d626fefa954be14b4d85" }),
    Object.freeze({ id: "warm-overlay", role: "warm-overlay", rect: Object.freeze({ x: 768, y: 0, width: 192, height: 160 }), destination: Object.freeze({ x: 0, y: 0 }), rgbaSha256: "48b4d3f15f1e81238d59e1e78bb9b499741ffe1df3e8b1b101673d36e710d2b9" }),
    Object.freeze({ id: "hoard-overlay", role: "hoard-overlay", rect: Object.freeze({ x: 960, y: 0, width: 192, height: 160 }), destination: Object.freeze({ x: 0, y: 0 }), rgbaSha256: "2af4279f15ca5a76c713c9047f37a796226ba2c044c84e28722efd12cd91d535" }),
    Object.freeze({ id: "warm-a", role: "warm-a", rect: Object.freeze({ x: 1152, y: 0, width: 192, height: 160 }), destination: Object.freeze({ x: 0, y: 0 }), rgbaSha256: "2dfd48146fc885ff9c8f800630640925d3d4c22f08fba065ae51c489ef3a0afe" }),
    Object.freeze({ id: "warm-b", role: "warm-b", rect: Object.freeze({ x: 1344, y: 0, width: 192, height: 160 }), destination: Object.freeze({ x: 0, y: 0 }), rgbaSha256: "2bbf1fcee163907d40d9ddcf7291af90b257cd7cfe645d97f1376caef3633dc2" }),
    Object.freeze({ id: "hoard-a", role: "hoard-a", rect: Object.freeze({ x: 1536, y: 0, width: 192, height: 160 }), destination: Object.freeze({ x: 0, y: 0 }), rgbaSha256: "87430ebc4c812b16f6b21efe523bf412edbc1e9e5360e0f9a03d6d7e2af43f3d" }),
    Object.freeze({ id: "hoard-b", role: "hoard-b", rect: Object.freeze({ x: 1728, y: 0, width: 192, height: 160 }), destination: Object.freeze({ x: 0, y: 0 }), rgbaSha256: "4de9768013e1d46f1c26bc311af23eefe1dac9ba6d406971a43ff5a590fa251b" }),
  ]),
});

const SYNTHETIC_TERRAIN_AUTHORITY_CONTRACT = Object.freeze({
  assetId: "r5-oracle-synthetic-terrain-authority",
  pngSha256: "7846f6c488de3e1aa3880aab2133ed92110fa7e75f6f904b7fc799b6c0f5489e",
  width: 256,
  height: 256,
  sceneWidth: 256,
  sceneHeight: 256,
  layerInventory: Object.freeze(["terrain-atlas"]),
  roleInventory: Object.freeze(["terrain-atlas"]),
  layers: Object.freeze([
    Object.freeze({ id: "terrain-atlas", role: "terrain-atlas", rect: Object.freeze({ x: 0, y: 0, width: 256, height: 256 }), destination: Object.freeze({ x: 0, y: 0 }), rgbaSha256: "51b0b3714b0334fa93416ea019b1b2320606af8db18c2796f472dddeb72653cd" }),
  ]),
});

const SYNTHETIC_HOME_ACTOR_AUTHORITY_CONTRACT = Object.freeze({
  assetId: "r5-oracle-synthetic-home-actor-authority",
  pngSha256: "ad3bcf22c1c93f3df99bfe5d8b2dc62a909899f7a1bd66b24c43caf0ff98d1b6",
  width: 192,
  height: 160,
  sceneWidth: 192,
  sceneHeight: 160,
  layerInventory: Object.freeze(["home-actor"]),
  roleInventory: Object.freeze(["home-actor"]),
  layers: Object.freeze([
    Object.freeze({ id: "home-actor", role: "home-actor", rect: Object.freeze({ x: 0, y: 0, width: 192, height: 160 }), destination: Object.freeze({ x: 0, y: 0 }), rgbaSha256: "7c64bd8cb8bdd10708a0ca48d72002accc69668cb7e2d626fefa954be14b4d85" }),
  ]),
});

const syntheticHumanSourceContract = (assetId, pngSha256, occluderRgbaSha256) => Object.freeze({
  assetId,
  pngSha256,
  width: 1536,
  height: 512,
  sceneWidth: 768,
  sceneHeight: 512,
  layerInventory: Object.freeze(["background", "occluder"]),
  roleInventory: Object.freeze(["background", "occluder"]),
  layers: Object.freeze([
    Object.freeze({ id: "background", role: "background", rect: Object.freeze({ x: 0, y: 0, width: 768, height: 512 }), destination: Object.freeze({ x: 0, y: 0 }), rgbaSha256: "64166159dafa3c7a4511537183fa473353ea08e40d7cbeadd7eb9dba482c5f6a" }),
    Object.freeze({ id: "occluder", role: "occluder", rect: Object.freeze({ x: 768, y: 0, width: 768, height: 512 }), destination: Object.freeze({ x: 0, y: 0 }), rgbaSha256: occluderRgbaSha256 }),
  ]),
});

const SYNTHETIC_HUMAN_CLEAR_SOURCE_CONTRACT = syntheticHumanSourceContract(
  "r5-oracle-synthetic-human-clear-atlas",
  "388fd77a36ec8ff6858f815051b141436d844197878d37362ec0b9b411ca1b63",
  "106f0647ae10a6516b1ab2968038161e287ef40d1b22ca047531ed768e594ef1",
);
const SYNTHETIC_HUMAN_OCCLUDED_SOURCE_CONTRACT = syntheticHumanSourceContract(
  "r5-oracle-synthetic-human-occluded-atlas",
  "8214388d4dc046c91cd5a2da7b37d4de8bad2a3772fa74c7f3e14cf410ef1836",
  "691fc5f84adbf0481e59080c85e03bf15da70fb42a60b185bf59948b086ee4a6",
);

export const R5_SYNTHETIC_TRUSTED_SOURCE_ROWS = closedRegistry([
  ["synthetic-cluster", SYNTHETIC_SCENERY_SOURCE_CONTRACT],
  ["synthetic-ash", SYNTHETIC_ASH_SOURCE_CONTRACT],
  ["synthetic-lifecycle", SYNTHETIC_LIFECYCLE_SOURCE_CONTRACT],
  ["synthetic-terrain", SYNTHETIC_TERRAIN_AUTHORITY_CONTRACT],
  ["synthetic-home-actor", SYNTHETIC_HOME_ACTOR_AUTHORITY_CONTRACT],
  ["clear", SYNTHETIC_HUMAN_CLEAR_SOURCE_CONTRACT],
  ["occluded", SYNTHETIC_HUMAN_OCCLUDED_SOURCE_CONTRACT],
]);

export const R5_PRODUCTION_HUMAN_CONTRACT = Object.freeze({
  assetId: "core-human-body-rigs:1",
  rig: "human-a",
  facing: "south",
  action: "idle",
  frameIndex: 1,
  expression: "neutral",
  clothing: "core-human-clothing-00:1",
  feet: Object.freeze({ x: 24, y: 61 }),
  canonicalPatchSha256: "4bcdc9f7fc15ab203eb96e99cb1108c3b884e198be284c6b958170f9f5f67e0e",
  layers: Object.freeze([
    Object.freeze({ atlasId: "core-human-body-rigs", atlasSha256: "edb6d5dfadaf9714d00b392da7ee89931d145cc6226184abf7835d23f4a67716", cellIndex: 1, path: "scratchpad/2d-production-art/source/native/core/human-body-rigs.png" }),
    Object.freeze({ atlasId: "core-human-face-planes", atlasSha256: "4673092a327f228bbae97b1fdaa460d2d39a3470bdbc65920e32e8ef14c4cc6e", cellIndex: 0, path: "scratchpad/2d-production-art/source/native/core/human-face-planes.png" }),
    Object.freeze({ atlasId: "core-human-hair", atlasSha256: "add7fea3720162c7cfbafb215d92b5d41031cf9843b47df5f26eafdc2877861c", cellIndex: 0, path: "scratchpad/2d-production-art/source/native/core/human-hair.png" }),
    Object.freeze({ atlasId: "core-human-clothing-00", atlasSha256: "da3743c71a78e78fe458a409fade7f25eb2c099ab6bba7764e6fc9a6734aa0f2", cellIndex: 1, path: "scratchpad/2d-production-art/source/native/core/human-clothing-00.png" }),
  ]),
});

export const R5_ASH_FORBIDDEN_RGB = Object.freeze([
  Object.freeze([84, 168, 160]),
  Object.freeze([172, 236, 188]),
  Object.freeze([113, 132, 92]),
  Object.freeze([68, 124, 156]),
]);

export const R5_ASH_ALLOWED_RGB = Object.freeze([
  "28,28,36",
  "43,42,48",
  "80,72,67",
  "105,90,76",
  "130,108,85",
  "155,126,94",
  "68,68,84",
  "100,92,108",
  "124,116,132",
  "184,76,76",
  "228,108,92",
  "244,156,116",
]);

const STRICT_PURE_GROUND_INDICES = Object.freeze({
  "worn-heartland": Object.freeze([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,108,109,110,111,112,113,114,115,116,117,118,119,120,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,156,157,158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,180,181,182,183,184,185,186,187,188,189,190,191,192,193,194,195,196,197,198,199,204,209,210,211,212,213,214,215,216,217,218,219,220,221,222,223,224,225,226,228,233,234,235,236,237,238,239,240,241,242,243,244,245,246,247,248,249,250,252,263,264,265,266,267,268,269,270,271,272,273,274,276,287,288,289,290,291,292,293,294,295,296,297,298,300,311,312,313,314,315,316,317,318,319,320,321,322,335,336,337,338,339,340,341,342,343,344,345,346,347,348,349,350,351,359,360,361,362,363,364,365,366,367,368,369,370,371,372,373,374,375,376,377,378,379,380,381,382,383]),
  "spring-terraces": Object.freeze([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,133,134,135,136,137,138,139,140,141,142,143,144,151,152,153,154,155,156,157,163,164,165,166,167,168,177,178,179,180,181,183,184,185,187,188,189,190,191,201,202,203,204,205,207,208,209,211,212,213,214,215,216,225,226,227,228,229,238,239,240,249,250,251,252,253,262,263,264,265,286,287,288,289,290,295,296,297,298,299,300,301,302,310,311,312,313,314,315,318,319,320,321,322,323,324,325,326,334,335,336,337,338,339,340,341,342,343,344,345,346,347,348,349,350,351,352,353,354,355,356,357,358,359,360,361,362,363,364,365,366,367,368,369,370,371,372,373,374,375,376,377,378,379,380,381,382,383]),
  "dry-scrub": Object.freeze([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,68,69,70,71,72,73,74,79,80,81,82,87,96,97,98,103,104,105,106,111,118,119,120,121,122,127,128,129,130,135,142,143,144,145,146,147,148,149,150,151,152,153,154,166,167,168,169,170,171,172,173,174,175,176,177,178,185,190,191,192,193,194,195,196,197,198,199,200,201,202,203,216,217,218,219,220,221,222,223,224,225,226,227,240,241,242,243,244,245,246,247,248,249,250,251,252,264,265,266,267,268,269,270,271,272,273,274,275,276,288,289,290,291,292,293,294,295,296,297,298,299,300,312,313,314,315,316,317,318,319,320,321,322,323,324,325,326,327,328,329,330,331,332,333,334,335,336,337,338,339,340,341,342,343,344,345,346,347,348,349,350,351,352,353,354,355,356,357,358,359,360,361,362,363,364,365,366,367,368,369,370,371,372,373,374,375,376,377,378,379,380,381,382,383]),
  "ash-waste": Object.freeze([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,185,186,187,188,189,190,191,192,193,198,199,200,213,214,215,216,217,222,223,224,225,227,228,239,240,241,246,247,248,249,251,252,263,264,265,275,276,277,278,279,287,288,289,294,295,296,297,298,299,300,301,302,303,311,312,313,314,315,317,318,319,320,321,322,323,324,325,326,327,335,336,337,338,339,341,342,343,344,345,346,347,348,349,350,351,352,353,354,355,356,357,358,359,360,361,362,363,365,366,367,368,369,370,371,372,373,374,375,376,377,378,379,380,381,382,383]),
  "neutral-temperate": Object.freeze([0,1,2,3,4,5,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,77,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,152,157,158,159,160,161,162,163,164,165,166,167,168,169,176,181,182,183,184,185,186,187,188,189,190,191,192,193,194,195,208,209,210,211,212,213,214,215,216,217,218,219,220,221,222,223,224,232,233,234,235,236,237,238,239,240,241,242,243,244,245,246,247,248,249,250,251,261,262,263,264,265,266,267,268,269,270,271,272,273,274,275,285,286,287,288,289,290,291,292,293,294,295,296,297,298,299,309,310,311,312,313,314,315,316,317,318,319,320,321,322,323,333,334,335,336,337,338,339,340,341,342,343,344,345,346,347,348,349,357,358,359,360,361,362,363,364,365,366,367,368,369,370,371,372,373,374,375,376,377,378,379,380,381,382,383]),
});

const PURE_GROUND_DIGESTS = Object.freeze({
  "worn-heartland": "ec4aa5de18d62430494d4bf48a17f72091befdc3d60f165e4e1eb0ec35eebcd4",
  "spring-terraces": "ee196e8bf1c3779d2eb237f1c42ad86d1a9d04bd11a05c4390ac1d63f1362ad6",
  "dry-scrub": "b81c33e16f18164b9dfdcd0efbf341b89ff04ff1df1def5912093c6e6632a417",
  "ash-waste": "756a6b7e1aeb9c57077fa8cf876a93ffe3ccbb00b865f17db2cf385c92c2ca77",
  "neutral-temperate": "8ee9ee50bbda1b0beb6eba29ffe6b3228726cfaf57a49c9308cbf2cc9b19cf82",
});

const PURE_GROUND_PAIR_COUNTS = Object.freeze({
  "worn-heartland": Object.freeze({ x: Object.freeze([232,216,196,176,161,143,126,114]), y: Object.freeze([219,185,156,130,108,100,86,76]) }),
  "spring-terraces": Object.freeze({ x: Object.freeze([233,206,186,169,153,147,137,128]), y: Object.freeze([215,171,139,114,98,91,89,80]) }),
  "dry-scrub": Object.freeze({ x: Object.freeze([225,200,179,161,157,149,143,132]), y: Object.freeze([210,173,136,126,116,108,98,88]) }),
  "ash-waste": Object.freeze({ x: Object.freeze([241,215,196,177,169,157,141,131]), y: Object.freeze([232,191,158,127,105,93,89,85]) }),
  "neutral-temperate": Object.freeze({ x: Object.freeze([234,204,178,158,144,126,115,104]), y: Object.freeze([226,194,164,138,116,100,87,81]) }),
});

export const R5_PURE_GROUND_TILE_CONTRACTS = closedRegistry(
  Object.entries(STRICT_PURE_GROUND_INDICES).map(([kit, indices]) => [kit, Object.freeze({
    columns: 24,
    rows: 16,
    digest: PURE_GROUND_DIGESTS[kit],
    eligibleTileIndices: indices,
    shiftPairCounts: PURE_GROUND_PAIR_COUNTS[kit],
  })]),
);

const LANDMARK_LIMITS = Object.freeze({
  colorsMin: 4,
  significantColorsMin: 3,
  significantShareMin: 0.02,
  dominantShareMax: 0.75,
  differingEdgeDensityMin: 0.02,
  differingEdgeDensityMax: 0.45,
  tinyComponentShareMax: 0.08,
  silhouetteWidthMin: 64,
  silhouetteHeightMin: 48,
});
const WALLPAPER_LIMIT = 0.28;
const SYNTHETIC_GROUND_CONTRACTS = Object.freeze({
  "all-ground-18x12": Object.freeze({
    columns: 18,
    rows: 12,
    eligibleTileIndices: Object.freeze(Array.from({ length: 216 }, (_unused, index) => index)),
    shiftPairCounts: Object.freeze({
      x: Object.freeze([204,192,180,168,156,144,132,120]),
      y: Object.freeze([198,180,162,144,126,108,90,72]),
    }),
  }),
});
const YARD_LIMITS = Object.freeze({
  coverageMin: 0.08,
  coverageMax: 0.55,
  borderTransparencyMin: 0.9,
  corridorCoverageMax: 0.08,
  wrapCoverageMin: 0.65,
});

function assertImage(image, label = "image") {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height)
      || image.width <= 0 || image.height <= 0 || !image.data
      || image.data.length !== image.width * image.height * 4) {
    throw new TypeError(`${label} must be width x height RGBA bytes`);
  }
}

function rgbaKey(data, offset) {
  return `${data[offset]},${data[offset + 1]},${data[offset + 2]},${data[offset + 3]}`;
}

function alphaMask(image) {
  const result = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < result.length; pixel += 1) result[pixel] = image.data[pixel * 4 + 3] > 0 ? 1 : 0;
  return result;
}

function boundsForMask(data, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let pixels = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (data[y * width + x] === 0) continue;
    pixels += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return pixels === 0
    ? { minX: 0, minY: 0, maxX: -1, maxY: -1, width: 0, height: 0, pixels: 0 }
    : { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1, pixels };
}

function maskComponents(data, width, height) {
  const seen = new Uint8Array(data.length);
  const components = [];
  const queue = new Int32Array(data.length);
  for (let seed = 0; seed < data.length; seed += 1) {
    if (data[seed] === 0 || seen[seed] !== 0) continue;
    let head = 0;
    let tail = 1;
    queue[0] = seed;
    seen[seed] = 1;
    let pixels = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let touchesEdge = false;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      pixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;
      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (let position = 0; position < neighbors.length; position += 1) {
        const neighbor = neighbors[position];
        if (neighbor < 0 || neighbor >= data.length || seen[neighbor] !== 0 || data[neighbor] === 0) continue;
        if (position === 0 && x === 0 || position === 1 && x === width - 1) continue;
        seen[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
    components.push({ pixels, minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1, touchesEdge });
  }
  return components;
}

function largestComponentMask(data, width, height) {
  const seen = new Uint8Array(data.length);
  const queue = new Int32Array(data.length);
  let largest = [];
  for (let seed = 0; seed < data.length; seed += 1) {
    if (data[seed] === 0 || seen[seed] !== 0) continue;
    let head = 0;
    let tail = 1;
    queue[0] = seed;
    seen[seed] = 1;
    const pixels = [];
    while (head < tail) {
      const index = queue[head++];
      pixels.push(index);
      const x = index % width;
      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (let position = 0; position < neighbors.length; position += 1) {
        const neighbor = neighbors[position];
        if (neighbor < 0 || neighbor >= data.length || seen[neighbor] !== 0 || data[neighbor] === 0) continue;
        if (position === 0 && x === 0 || position === 1 && x === width - 1) continue;
        seen[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
    if (pixels.length > largest.length) largest = pixels;
  }
  const result = new Uint8Array(data.length);
  for (const pixel of largest) result[pixel] = 1;
  return result;
}

function dilate(data, width, height, radius) {
  const result = new Uint8Array(data.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (data[y * width + x] === 0) continue;
    for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) result[ny * width + nx] = 1;
    }
  }
  return result;
}

function masksTouch(left, right, width, height, radius = 1) {
  const expanded = dilate(left, width, height, radius);
  for (let index = 0; index < expanded.length; index += 1) if (expanded[index] !== 0 && right[index] !== 0) return true;
  return false;
}

function copyCell(image, cellIndex, columns, cellWidth, cellHeight) {
  const x0 = cellIndex % columns * cellWidth;
  const y0 = Math.floor(cellIndex / columns) * cellHeight;
  if (x0 + cellWidth > image.width || y0 + cellHeight > image.height) throw new RangeError("cell exceeds image bounds");
  const data = Buffer.alloc(cellWidth * cellHeight * 4);
  for (let y = 0; y < cellHeight; y += 1) {
    const start = ((y0 + y) * image.width + x0) * 4;
    image.data.copy(data, y * cellWidth * 4, start, start + cellWidth * 4);
  }
  return { data, width: cellWidth, height: cellHeight };
}

export function analyzeLandmarkMaterialDepth(image) {
  assertImage(image, "landmark");
  const opaque = alphaMask(image);
  const largestMask = largestComponentMask(opaque, image.width, image.height);
  const silhouette = boundsForMask(largestMask, image.width, image.height);
  let differingEdges = 0;
  let horizontalDifferingEdges = 0;
  let verticalDifferingEdges = 0;
  let internalEdges = 0;
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    const pixel = y * image.width + x;
    if (largestMask[pixel] === 0) continue;
    const offset = pixel * 4;
    const key = rgbaKey(image.data, offset);
    for (const neighbor of [[x + 1, y], [x, y + 1]]) {
      if (neighbor[0] >= image.width || neighbor[1] >= image.height) continue;
      const other = neighbor[1] * image.width + neighbor[0];
      if (largestMask[other] === 0) continue;
      internalEdges += 1;
      if (rgbaKey(image.data, other * 4) !== key) {
        differingEdges += 1;
        if (neighbor[0] !== x) horizontalDifferingEdges += 1;
        else verticalDifferingEdges += 1;
      }
    }
  }
  const allOpaquePixels = opaque.reduce((sum, value) => sum + value, 0);
  const allOpaqueColors = new Set();
  const allFrequencies = new Map();
  for (let pixel = 0; pixel < opaque.length; pixel += 1) {
    if (opaque[pixel] === 0) continue;
    const key = rgbaKey(image.data, pixel * 4);
    allOpaqueColors.add(key);
    allFrequencies.set(key, (allFrequencies.get(key) ?? 0) + 1);
  }
  const largestColorComponents = [];
  for (const key of allOpaqueColors) {
    const colorMask = new Uint8Array(opaque.length);
    for (let pixel = 0; pixel < opaque.length; pixel += 1) {
      if (opaque[pixel] !== 0 && rgbaKey(image.data, pixel * 4) === key) colorMask[pixel] = 1;
    }
    const components = maskComponents(colorMask, image.width, image.height);
    largestColorComponents.push(Math.max(0, ...components.map(({ pixels }) => pixels)));
  }
  let tinyPixels = 0;
  for (const key of allOpaqueColors) {
    const colorMask = new Uint8Array(opaque.length);
    for (let pixel = 0; pixel < opaque.length; pixel += 1) {
      if (opaque[pixel] !== 0 && rgbaKey(image.data, pixel * 4) === key) colorMask[pixel] = 1;
    }
    for (const component of maskComponents(colorMask, image.width, image.height)) {
      if (component.pixels < 3) tinyPixels += component.pixels;
    }
  }
  const opaquePixels = silhouette.pixels;
  const alphaComponents = maskComponents(opaque, image.width, image.height);
  const largestAlphaComponent = Math.max(0, ...alphaComponents.map(({ pixels }) => pixels));
  let groundContactPixels = 0;
  if (silhouette.height > 0) {
    for (let y = Math.max(silhouette.minY, silhouette.maxY - 3); y <= silhouette.maxY; y += 1) {
      for (let x = silhouette.minX; x <= silhouette.maxX; x += 1) groundContactPixels += largestMask[y * image.width + x];
    }
  }
  return {
    opaquePixels,
    opaqueColorCount: allFrequencies.size,
    dominantColorShare: Math.max(0, ...allFrequencies.values()) / Math.max(1, allOpaquePixels),
    differingColorEdgeDensity: differingEdges / Math.max(1, internalEdges),
    tinyComponentShare: tinyPixels / Math.max(1, allOpaquePixels),
    silhouetteWidth: silhouette.width,
    silhouetteHeight: silhouette.height,
    significantColorCount: largestColorComponents.filter((count) => count / Math.max(1, allOpaquePixels) >= LANDMARK_LIMITS.significantShareMin).length,
    connectedSilhouetteShare: largestAlphaComponent / Math.max(1, allOpaquePixels),
    alphaCoverageWithinBounds: opaquePixels / Math.max(1, silhouette.width * silhouette.height),
    horizontalDifferingEdgeShare: horizontalDifferingEdges / Math.max(1, differingEdges),
    verticalDifferingEdgeShare: verticalDifferingEdges / Math.max(1, differingEdges),
    transparentNegativeSpace: 1 - allOpaquePixels / (image.width * image.height),
    groundContactPixels,
  };
}

export function validateLandmarkMaterialDepth(image, label = "landmark-material-depth") {
  const value = analyzeLandmarkMaterialDepth(image);
  const errors = [];
  if (value.opaqueColorCount < LANDMARK_LIMITS.colorsMin) errors.push(`${label}: opaque colors ${value.opaqueColorCount} < ${LANDMARK_LIMITS.colorsMin}`);
  if (value.significantColorCount < LANDMARK_LIMITS.significantColorsMin) errors.push(`${label}: significant colors ${value.significantColorCount} < ${LANDMARK_LIMITS.significantColorsMin}`);
  if (value.dominantColorShare > LANDMARK_LIMITS.dominantShareMax) errors.push(`${label}: dominant color share ${value.dominantColorShare.toFixed(4)} > ${LANDMARK_LIMITS.dominantShareMax}`);
  if (value.differingColorEdgeDensity < LANDMARK_LIMITS.differingEdgeDensityMin
      || value.differingColorEdgeDensity > LANDMARK_LIMITS.differingEdgeDensityMax) {
    errors.push(`${label}: differing-color edge density ${value.differingColorEdgeDensity.toFixed(4)} outside 0.02-0.45`);
  }
  if (value.tinyComponentShare > LANDMARK_LIMITS.tinyComponentShareMax) errors.push(`${label}: tiny component share ${value.tinyComponentShare.toFixed(4)} > ${LANDMARK_LIMITS.tinyComponentShareMax}`);
  if (value.silhouetteWidth < LANDMARK_LIMITS.silhouetteWidthMin || value.silhouetteHeight < LANDMARK_LIMITS.silhouetteHeightMin) {
    errors.push(`${label}: silhouette ${value.silhouetteWidth}x${value.silhouetteHeight} below 64x48`);
  }
  if (value.connectedSilhouetteShare < 0.55) errors.push(`${label}: largest alpha component share ${value.connectedSilhouetteShare.toFixed(4)} < 0.55`);
  if (value.alphaCoverageWithinBounds > 0.88) errors.push(`${label}: largest component bounds coverage ${value.alphaCoverageWithinBounds.toFixed(4)} > 0.88`);
  if (value.horizontalDifferingEdgeShare < 0.15 || value.verticalDifferingEdgeShare < 0.15
      || value.silhouetteWidth / Math.max(1, value.silhouetteHeight) > 2) {
    errors.push(`${label}: implausible silhouette orientation lacks horizontal or vertical material edges`);
  }
  if (value.transparentNegativeSpace <= 0.02) errors.push(`${label}: transparent negative space missing`);
  if (value.groundContactPixels < 8) errors.push(`${label}: ground contact missing`);
  return errors;
}

function rgbCorrelation(image, dx, dy, channels = null) {
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  let count = 0;
  for (let y = 0; y < image.height - dy; y += 1) for (let x = 0; x < image.width - dx; x += 1) {
    const leftPixel = y * image.width + x;
    const rightPixel = (y + dy) * image.width + x + dx;
    for (let channel = 0; channel < 3; channel += 1) {
      const left = channels ? channels[leftPixel * 3 + channel] : image.data[leftPixel * 4 + channel];
      const right = channels ? channels[rightPixel * 3 + channel] : image.data[rightPixel * 4 + channel];
      sumA += left;
      sumB += right;
      sumAA += left * left;
      sumBB += right * right;
      sumAB += left * right;
      count += 1;
    }
  }
  const covariance = sumAB - sumA * sumB / Math.max(1, count);
  const varianceA = sumAA - sumA * sumA / Math.max(1, count);
  const varianceB = sumBB - sumB * sumB / Math.max(1, count);
  if (varianceA <= 1e-9 || varianceB <= 1e-9) return 0;
  return Math.abs(covariance / Math.sqrt(varianceA * varianceB));
}

function trustedGroundContractFor(image, options) {
  if (Object.hasOwn(options, "trustedGroundContract")) throw new TypeError("caller contracts are forbidden");
  const contract = options.syntheticControl
    ? SYNTHETIC_GROUND_CONTRACTS[options.syntheticControl]
    : R5_PURE_GROUND_TILE_CONTRACTS[options.kit];
  if (!contract || !Object.isFrozen(contract) || !Object.isFrozen(contract.eligibleTileIndices)) {
    throw new TypeError("trusted immutable pure-ground contract is required");
  }
  if (contract.columns * 32 !== image.width || contract.rows * 32 !== image.height) {
    throw new RangeError("trusted pure-ground geometry does not match composed pixels");
  }
  const indices = new Set(contract.eligibleTileIndices);
  if (indices.size !== contract.eligibleTileIndices.length || indices.size === 0
      || [...indices].some((index) => !Number.isInteger(index) || index < 0 || index >= contract.columns * contract.rows)) {
    throw new RangeError("trusted pure-ground indices are invalid or empty");
  }
  return { ...contract, eligible: indices };
}

function tileMeanResiduals(image, contract) {
  const residuals = new Float32Array(image.width * image.height * 3);
  for (const tile of contract.eligible) {
    const tileX = tile % contract.columns;
    const tileY = Math.floor(tile / contract.columns);
    const sums = [0, 0, 0];
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
      const offset = ((tileY * 32 + y) * image.width + tileX * 32 + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) sums[channel] += image.data[offset + channel];
    }
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
      const pixel = (tileY * 32 + y) * image.width + tileX * 32 + x;
      for (let channel = 0; channel < 3; channel += 1) residuals[pixel * 3 + channel] = image.data[pixel * 4 + channel] - sums[channel] / 1024;
    }
  }
  return residuals;
}

function eligibleResidualCorrelation(residuals, contract, dxTiles, dyTiles, imageWidth) {
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  let count = 0;
  let tilePairs = 0;
  for (const tile of contract.eligible) {
    const tileX = tile % contract.columns;
    const tileY = Math.floor(tile / contract.columns);
    const otherX = tileX + dxTiles;
    const otherY = tileY + dyTiles;
    if (otherX >= contract.columns || otherY >= contract.rows) continue;
    const other = otherY * contract.columns + otherX;
    if (!contract.eligible.has(other)) continue;
    tilePairs += 1;
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
      const leftPixel = (tileY * 32 + y) * imageWidth + tileX * 32 + x;
      const rightPixel = (otherY * 32 + y) * imageWidth + otherX * 32 + x;
      for (let channel = 0; channel < 3; channel += 1) {
        const left = residuals[leftPixel * 3 + channel];
        const right = residuals[rightPixel * 3 + channel];
        sumA += left;
        sumB += right;
        sumAA += left * left;
        sumBB += right * right;
        sumAB += left * right;
        count += 1;
      }
    }
  }
  const covariance = sumAB - sumA * sumB / Math.max(1, count);
  const varianceA = sumAA - sumA * sumA / Math.max(1, count);
  const varianceB = sumBB - sumB * sumB / Math.max(1, count);
  return {
    tilePairs,
    denominator: Math.sqrt(Math.max(0, varianceA) * Math.max(0, varianceB)),
    correlation: varianceA > 1e-9 && varianceB > 1e-9 ? Math.abs(covariance / Math.sqrt(varianceA * varianceB)) : 0,
  };
}

function phaseLockedResidualEnergy(residuals, contract, imageWidth) {
  const phaseSums = new Float64Array(32 * 32 * 3);
  let totalEnergy = 0;
  for (const tile of contract.eligible) {
    const tileX = tile % contract.columns;
    const tileY = Math.floor(tile / contract.columns);
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
      const pixel = (tileY * 32 + y) * imageWidth + tileX * 32 + x;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = residuals[pixel * 3 + channel];
        phaseSums[(y * 32 + x) * 3 + channel] += value;
        totalEnergy += value * value;
      }
    }
  }
  let lockedEnergy = 0;
  for (const sum of phaseSums) lockedEnergy += (sum / contract.eligible.size) ** 2;
  const meanTotalEnergy = totalEnergy / contract.eligible.size;
  return meanTotalEnergy > 1e-9 ? lockedEnergy / meanTotalEnergy : 0;
}

function tinyAccentShare(image, contract) {
  let accents = 0;
  let tiny = 0;
  for (const tile of contract.eligible) {
    const tileX = tile % contract.columns;
    const tileY = Math.floor(tile / contract.columns);
    const frequencies = new Map();
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
      const offset = ((tileY * 32 + y) * image.width + tileX * 32 + x) * 4;
      const key = `${image.data[offset]},${image.data[offset + 1]},${image.data[offset + 2]}`;
      frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
    }
    const dominant = [...frequencies].sort((left, right) => right[1] - left[1])[0][0];
    const accentMask = new Uint8Array(1024);
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
      const offset = ((tileY * 32 + y) * image.width + tileX * 32 + x) * 4;
      const key = `${image.data[offset]},${image.data[offset + 1]},${image.data[offset + 2]}`;
      if (key !== dominant) accentMask[y * 32 + x] = 1;
    }
    const components = maskComponents(accentMask, 32, 32);
    accents += components.reduce((sum, component) => sum + component.pixels, 0);
    tiny += components.filter(({ pixels }) => pixels <= 2).reduce((sum, component) => sum + component.pixels, 0);
  }
  return { accentPixels: accents, tinyAccentPixels: tiny, tinyAccentShare: tiny / Math.max(1, accents) };
}

function analyzeComposedWithContract(image, contract) {
  const cellSize = 32;
  const maxMultiple = 8;
  assertImage(image, "composed scene");
  const residuals = tileMeanResiduals(image, contract);
  const shifts = [];
  for (let multiple = 1; multiple <= maxMultiple; multiple += 1) {
    for (const [axis, dx, dy] of [["x", cellSize * multiple, 0], ["y", 0, cellSize * multiple]]) {
      if (dx >= image.width || dy >= image.height) continue;
      const residual = eligibleResidualCorrelation(residuals, contract, axis === "x" ? multiple : 0, axis === "y" ? multiple : 0, image.width);
      shifts.push({
        axis,
        multiple,
        pixels: cellSize * multiple,
        autocorrelation: rgbCorrelation(image, dx, dy),
        tileResidualAutocorrelation: residual.correlation,
        tilePairs: residual.tilePairs,
        denominator: residual.denominator,
        expectedTilePairs: contract.shiftPairCounts[axis][multiple - 1],
      });
    }
  }
  const accents = tinyAccentShare(image, contract);
  return {
    shifts,
    eligibleTileCount: contract.eligible.size,
    maximumAutocorrelation: Math.max(0, ...shifts.map(({ autocorrelation }) => autocorrelation)),
    maximumTileResidualAutocorrelation: Math.max(0, ...shifts.map(({ tileResidualAutocorrelation }) => tileResidualAutocorrelation)),
    p32: phaseLockedResidualEnergy(residuals, contract, image.width),
    ...accents,
  };
}

export function analyzeComposedPixelAutocorrelation(image, options = {}) {
  if (Object.hasOwn(options, "trustedGroundContract") || Object.hasOwn(options, "syntheticControl")
      || Object.hasOwn(options, "maxMultiple") || Object.hasOwn(options, "cellSize")) {
    throw new TypeError("caller contracts, synthetic controls, and candidate analysis knobs are forbidden");
  }
  return analyzeComposedWithContract(image, trustedGroundContractFor(image, options));
}

export function analyzeSyntheticComposedPixelAutocorrelation(image, controlId) {
  const contract = SYNTHETIC_GROUND_CONTRACTS[controlId];
  if (!contract) throw new TypeError("unknown synthetic ground control");
  if (contract.columns * 32 !== image.width || contract.rows * 32 !== image.height) throw new RangeError("synthetic ground geometry mismatch");
  return analyzeComposedWithContract(image, { ...contract, eligible: new Set(contract.eligibleTileIndices) });
}

function validateComposedMetrics(value) {
  const errors = [];
  for (const shift of value.shifts) {
    if (shift.tilePairs !== shift.expectedTilePairs) errors.push(`terrain-rgb-periodicity: ${shift.axis}${shift.multiple} trusted pair count ${shift.tilePairs} != ${shift.expectedTilePairs}`);
    if (shift.tilePairs === 0 || shift.denominator <= 1e-9) errors.push(`terrain-rgb-periodicity: ${shift.axis}${shift.multiple} has zero trusted denominator`);
    else if (shift.tileResidualAutocorrelation > WALLPAPER_LIMIT) errors.push(`terrain-rgb-periodicity: ${shift.axis}${shift.multiple}=${shift.tileResidualAutocorrelation.toFixed(4)} > ${WALLPAPER_LIMIT}`);
  }
  if (value.p32 > 0.1) errors.push(`terrain-phase-locked-motif: P32=${value.p32.toFixed(4)} > 0.10`);
  if (value.tinyAccentShare > 0.1) errors.push(`terrain-accent-speckle: ${value.tinyAccentShare.toFixed(4)} > 0.10`);
  return errors;
}

export function validateSyntheticComposedPixelAutocorrelation(image, controlId) {
  try {
    return validateComposedMetrics(analyzeSyntheticComposedPixelAutocorrelation(image, controlId));
  } catch (error) {
    return [`synthetic-terrain-control: ${error.message}`];
  }
}

export function validateComposedPixelAutocorrelation(image, options = {}) {
  const label = options.label ?? "terrain";
  const errors = [];
  if (Object.hasOwn(options, "trustedGroundContract")) return ["trusted-ground-mask: caller contracts are forbidden"];
  if (Object.hasOwn(options, "syntheticControl")) return ["trusted-ground-mask: synthetic controls are forbidden on production validation"];
  if (Object.hasOwn(options, "maxMultiple") || Object.hasOwn(options, "cellSize")) return ["candidate analysis knobs are forbidden"];
  if (Object.keys(options).some((key) => /candidate.*(?:mask|exclusion)|threshold|denominator|maximumAutocorrelation/i.test(key))) {
    if (Object.keys(options).some((key) => /candidate.*(?:mask|exclusion)/i.test(key))) errors.push("trusted-ground-mask: candidate masks are forbidden");
    if (Object.keys(options).some((key) => /threshold|denominator|maximumAutocorrelation/i.test(key))) errors.push("candidate thresholds or denominators are forbidden");
  }
  let value;
  try {
    value = analyzeComposedPixelAutocorrelation(image, options);
  } catch (error) {
    errors.push(`trusted-ground-mask: ${error.message}`);
    return errors;
  }
  return [...errors, ...validateComposedMetrics(value)];
}

/** Measure exact native 32px scene-window diversity without caller-adjustable thresholds. */
export function analyzeComposedPixelSpatialVariety(image, options = {}) {
  assertImage(image, "composed spatial-variety scene");
  if (Reflect.ownKeys(options).length !== 0) {
    throw new TypeError("composed spatial-variety analysis forbids caller knobs");
  }
  if (image.width !== 768 || image.height !== 512) {
    throw new RangeError("composed spatial-variety scene must be exact 768x512 native pixels");
  }
  const cellSize = 32;
  const columns = image.width / cellSize;
  const rows = image.height / cellSize;
  const counts = new Map();
  for (let tileY = 0; tileY < rows; tileY += 1) {
    for (let tileX = 0; tileX < columns; tileX += 1) {
      const bytes = Buffer.alloc(cellSize * cellSize * 4);
      for (let localY = 0; localY < cellSize; localY += 1) {
        const sourceOffset = (((tileY * cellSize + localY) * image.width) + tileX * cellSize) * 4;
        image.data.copy(
          bytes,
          localY * cellSize * 4,
          sourceOffset,
          sourceOffset + cellSize * 4,
        );
      }
      const digest = createHash("sha256").update(bytes).digest("hex");
      counts.set(digest, (counts.get(digest) ?? 0) + 1);
    }
  }
  const repeatedCounts = [...counts.values()].filter((count) => count > 1);
  return Object.freeze({
    totalWindows: columns * rows,
    uniqueWindowHashes: counts.size,
    maximumRepeat: Math.max(...counts.values()),
    windowsInRepeatedGroups: repeatedCounts.reduce((sum, count) => sum + count, 0),
  });
}

function projectedCoverage(maskData, width, range, axis) {
  let covered = 0;
  const total = axis === "x" ? range.x1 - range.x0 : range.y1 - range.y0;
  if (axis === "x") {
    for (let x = range.x0; x < range.x1; x += 1) {
      let hit = false;
      for (let y = range.y0; y < range.y1; y += 1) hit ||= maskData[y * width + x] !== 0;
      covered += hit ? 1 : 0;
    }
  } else {
    for (let y = range.y0; y < range.y1; y += 1) {
      let hit = false;
      for (let x = range.x0; x < range.x1; x += 1) hit ||= maskData[y * width + x] !== 0;
      covered += hit ? 1 : 0;
    }
  }
  return covered / Math.max(1, total);
}

function hasConnectedThreeSidedWrap(opaque, width, height) {
  const seen = new Uint8Array(opaque.length);
  const queue = new Int32Array(opaque.length);
  for (let seed = 0; seed < opaque.length; seed += 1) {
    if (opaque[seed] === 0 || seen[seed] !== 0) continue;
    let head = 0;
    let tail = 1;
    queue[0] = seed;
    seen[seed] = 1;
    const component = new Uint8Array(opaque.length);
    while (head < tail) {
      const index = queue[head++];
      component[index] = 1;
      const x = index % width;
      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (let position = 0; position < neighbors.length; position += 1) {
        const neighbor = neighbors[position];
        if (neighbor < 0 || neighbor >= opaque.length || seen[neighbor] !== 0 || opaque[neighbor] === 0) continue;
        if (position === 0 && x === 0 || position === 1 && x === width - 1) continue;
        seen[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
    const north = projectedCoverage(component, width, { x0: 32, x1: 160, y0: 0, y1: 80 }, "x");
    const left = projectedCoverage(component, width, { x0: 0, x1: 48, y0: 16, y1: 144 }, "y");
    const right = projectedCoverage(component, width, { x0: 144, x1: 192, y0: 16, y1: 144 }, "y");
    if (north >= YARD_LIMITS.wrapCoverageMin && left >= YARD_LIMITS.wrapCoverageMin && right >= YARD_LIMITS.wrapCoverageMin) return true;
  }
  return false;
}

function enclosedTransparentSocketMetrics(opaque, width, height) {
  const transparent = Uint8Array.from(opaque, (value) => value === 0 ? 1 : 0);
  const seen = new Uint8Array(transparent.length);
  const queue = new Int32Array(transparent.length);
  const footprint = { x0: 48, x1: 144, y0: 32, y1: 128 };
  const footprintArea = (footprint.x1 - footprint.x0) * (footprint.y1 - footprint.y0);
  let enclosedHoleCount = 0;
  let forbiddenSocketCount = 0;
  for (let seed = 0; seed < transparent.length; seed += 1) {
    if (transparent[seed] === 0 || seen[seed] !== 0) continue;
    let head = 0;
    let tail = 1;
    let pixels = 0;
    let footprintPixels = 0;
    let containsCenter = false;
    let touchesEdge = false;
    queue[0] = seed;
    seen[seed] = 1;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      pixels += 1;
      containsCenter ||= x === 96 && y === 80;
      if (x >= footprint.x0 && x < footprint.x1 && y >= footprint.y0 && y < footprint.y1) footprintPixels += 1;
      touchesEdge ||= x === 0 || y === 0 || x === width - 1 || y === height - 1;
      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (let position = 0; position < neighbors.length; position += 1) {
        const neighbor = neighbors[position];
        if (neighbor < 0 || neighbor >= transparent.length || seen[neighbor] !== 0 || transparent[neighbor] === 0) continue;
        if (position === 0 && x === 0 || position === 1 && x === width - 1) continue;
        seen[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
    if (touchesEdge || pixels < 64) continue;
    enclosedHoleCount += 1;
    if (containsCenter || footprintPixels >= footprintArea / 2) forbiddenSocketCount += 1;
  }
  return { enclosedHoleCount, forbiddenSocketCount };
}

function exactRectCoverage(opaque, width, { x0, x1, y0, y1 }) {
  let covered = 0;
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) covered += opaque[y * width + x];
  return covered / ((x1 - x0) * (y1 - y0));
}

function transparentCorridorReachesSouth(opaque, width, height) {
  const corridor = { x0: 80, x1: 112, y0: 73, y1: 160 };
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (let x = 81; x < 111; x += 1) {
    const index = 73 * width + x;
    if (opaque[index] === 0) {
      seen[index] = 1;
      queue[tail++] = index;
    }
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (y === height - 1) return true;
    const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of neighbors) {
      if (nx < corridor.x0 || nx >= corridor.x1 || ny < corridor.y0 || ny >= corridor.y1) continue;
      const neighbor = ny * width + nx;
      if (seen[neighbor] !== 0 || opaque[neighbor] !== 0) continue;
      seen[neighbor] = 1;
      queue[tail++] = neighbor;
    }
  }
  return false;
}

export function analyzeYardCell(image) {
  assertImage(image, "yard");
  if (image.width !== 192 || image.height !== 160) throw new RangeError("yard must be the exact 192x160 lifecycle cell");
  const opaque = alphaMask(image);
  const opaquePixels = opaque.reduce((sum, value) => sum + value, 0);
  const border = 4;
  let borderPixels = 0;
  let borderOpaque = 0;
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    if (!(x < border || y < border || x >= image.width - border || y >= image.height - border)) continue;
    borderPixels += 1;
    borderOpaque += opaque[y * image.width + x];
  }
  const corridor = { x0: 80, x1: 112, y0: 73, y1: 160 };
  const door = { x0: 81, x1: 111, y0: 73, y1: 121 };
  const bounds = boundsForMask(opaque, image.width, image.height);
  const boundsArea = bounds.width * bounds.height;
  const northCoverage = projectedCoverage(opaque, image.width, { x0: 32, x1: 160, y0: 0, y1: 48 }, "x");
  const leftCoverage = projectedCoverage(opaque, image.width, {
    x0: 0, x1: 48, y0: 16, y1: 144,
  }, "y");
  const rightCoverage = projectedCoverage(opaque, image.width, {
    x0: 144, x1: 192, y0: 16, y1: 144,
  }, "y");
  const sockets = enclosedTransparentSocketMetrics(opaque, image.width, image.height);
  return {
    alphaCoverage: opaquePixels / opaque.length,
    borderTransparency: 1 - borderOpaque / Math.max(1, borderPixels),
    doorClearanceCoverage: exactRectCoverage(opaque, image.width, door),
    corridorCoverage: exactRectCoverage(opaque, image.width, corridor),
    corridorConnectedToSouth: transparentCorridorReachesSouth(opaque, image.width, image.height),
    transparentHoleShareWithinOpaqueBounds: 1 - opaquePixels / Math.max(1, boundsArea),
    northCoverage,
    leftCoverage,
    rightCoverage,
    threeSidedWrap: hasConnectedThreeSidedWrap(opaque, image.width, image.height),
    enclosedSocketCount: sockets.forbiddenSocketCount,
    enclosedHoleCount: sockets.enclosedHoleCount,
  };
}

export function validateYardCell(image, label = "yard") {
  const value = analyzeYardCell(image);
  const errors = [];
  if (value.alphaCoverage < YARD_LIMITS.coverageMin || value.alphaCoverage > YARD_LIMITS.coverageMax) errors.push(`${label}-coverage: ${value.alphaCoverage.toFixed(4)} outside 0.08-0.55`);
  if (value.borderTransparency < YARD_LIMITS.borderTransparencyMin) errors.push(`${label}-border: transparency ${value.borderTransparency.toFixed(4)} < 0.90`);
  if (value.doorClearanceCoverage > 0) errors.push(`${label}-door-clearance: exact [81,111)x[73,121) rectangle is not empty`);
  if (value.corridorCoverage > YARD_LIMITS.corridorCoverageMax) errors.push(`${label}-corridor: coverage ${value.corridorCoverage.toFixed(4)} > 0.08`);
  if (!value.corridorConnectedToSouth) errors.push(`${label}-corridor-connectivity: door does not reach the south edge`);
  if (value.transparentHoleShareWithinOpaqueBounds < 0.25) errors.push(`${label}-negative-space: transparent share ${value.transparentHoleShareWithinOpaqueBounds.toFixed(4)} < 0.25 inside opaque bounds`);
  if (value.threeSidedWrap) errors.push(`${label}-three-sided-wrap: north/left/right all >= 0.65`);
  if (value.enclosedSocketCount > 0) errors.push(`${label}-enclosed-socket: ${value.enclosedSocketCount}`);
  return errors;
}

function alphaSymmetricDifferenceOverUnion(left, right) {
  const leftAlpha = alphaMask(left);
  const rightAlpha = alphaMask(right);
  let difference = 0;
  let union = 0;
  for (let pixel = 0; pixel < leftAlpha.length; pixel += 1) {
    if (leftAlpha[pixel] !== rightAlpha[pixel]) difference += 1;
    if (leftAlpha[pixel] !== 0 || rightAlpha[pixel] !== 0) union += 1;
  }
  return difference / Math.max(1, union);
}

export function analyzeYardLifecycle({ baseA, baseB, ruin }) {
  for (const [label, image] of Object.entries({ baseA, baseB, ruin })) {
    assertImage(image, label);
    if (image.width !== 192 || image.height !== 160) throw new RangeError(`${label} must be 192x160`);
  }
  return {
    states: [analyzeYardCell(baseA), analyzeYardCell(baseB), analyzeYardCell(ruin)],
    baseABAlphaSymmetricDifference: alphaSymmetricDifferenceOverUnion(baseA, baseB),
    baseRuinAlphaSymmetricDifference: alphaSymmetricDifferenceOverUnion(baseA, ruin),
    baseBRuinAlphaSymmetricDifference: alphaSymmetricDifferenceOverUnion(baseB, ruin),
  };
}

export function validateYardLifecycle(input) {
  if (!input || Object.keys(input).some((key) => /mask|threshold|denominator|claimed|exclusion/i.test(key))) {
    return ["yard-contract: candidate masks, thresholds, denominators, and claims are forbidden"];
  }
  let value;
  try {
    value = analyzeYardLifecycle(input);
  } catch (error) {
    return [`yard-contract: malformed lifecycle cells (${error.message})`];
  }
  const errors = [];
  for (const [index, image] of [input.baseA, input.baseB, input.ruin].entries()) {
    errors.push(...validateYardCell(image, ["standing-a", "standing-b", "ruin"][index]));
  }
  if (value.baseABAlphaSymmetricDifference < 0.08) errors.push(`yard-state-symmetric-difference: standing-a/standing-b ${value.baseABAlphaSymmetricDifference.toFixed(4)} < 0.08`);
  if (value.baseRuinAlphaSymmetricDifference < 0.12) errors.push(`yard-state-symmetric-difference: standing-a/ruin ${value.baseRuinAlphaSymmetricDifference.toFixed(4)} < 0.12`);
  if (value.baseBRuinAlphaSymmetricDifference < 0.12) errors.push(`yard-state-symmetric-difference: standing-b/ruin ${value.baseBRuinAlphaSymmetricDifference.toFixed(4)} < 0.12`);
  return errors;
}

export function analyzeOverlayVisibility(image) {
  assertImage(image, "overlay");
  const opaque = alphaMask(image);
  const opaquePixels = opaque.reduce((sum, value) => sum + value, 0);
  const components = maskComponents(opaque, image.width, image.height);
  const largest = Math.max(0, ...components.map(({ pixels }) => pixels));
  return {
    opaquePixels,
    alphaCoverage: opaquePixels / opaque.length,
    componentCount: components.length,
    largestComponentPixels: largest,
    largestComponentShare: largest / Math.max(1, opaquePixels),
    tinyComponentShare: components.filter(({ pixels }) => pixels < 3).reduce((sum, component) => sum + component.pixels, 0) / Math.max(1, opaquePixels),
  };
}

export function validateOverlayVisibility(image, label = "overlay") {
  const value = analyzeOverlayVisibility(image);
  const errors = [];
  if (value.alphaCoverage < 0.005 || value.alphaCoverage > 0.2 || value.largestComponentPixels < 32) errors.push(`${label}-visibility: localized opaque object is not materially visible`);
  if (value.opaquePixels > 0 && (value.largestComponentShare < 0.55 || value.tinyComponentShare > 0.15)) errors.push(`${label}-connectivity: overlay is fragmented or confetti`);
  return errors;
}

function compositeDeltaMetrics(baseline, composite, overlay) {
  const changed = new Uint8Array(baseline.width * baseline.height);
  let deltaPixels = 0;
  let squaredRgbDelta = 0;
  for (let pixel = 0; pixel < changed.length; pixel += 1) {
    let differs = false;
    for (let channel = 0; channel < 4; channel += 1) differs ||= baseline.data[pixel * 4 + channel] !== composite.data[pixel * 4 + channel];
    if (!differs) continue;
    changed[pixel] = 1;
    deltaPixels += 1;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = composite.data[pixel * 4 + channel] - baseline.data[pixel * 4 + channel];
      squaredRgbDelta += delta * delta;
    }
  }
  const rawAlpha = alphaMask(overlay).reduce((sum, value) => sum + value, 0);
  const components = maskComponents(changed, baseline.width, baseline.height);
  const largest = Math.max(0, ...components.map(({ pixels }) => pixels));
  const tiny = components.filter(({ pixels }) => pixels <= 2).reduce((sum, component) => sum + component.pixels, 0);
  return {
    changed,
    deltaPixels,
    deltaShare: deltaPixels / changed.length,
    visibleAlphaShare: deltaPixels / Math.max(1, rawAlpha),
    rms: Math.sqrt(squaredRgbDelta / Math.max(1, deltaPixels * 3)),
    componentCount: components.length,
    largestComponentShare: largest / Math.max(1, deltaPixels),
    tinyComponentShare: tiny / Math.max(1, deltaPixels),
  };
}

function maskIoU(left, right) {
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < left.length; index += 1) {
    intersection += left[index] !== 0 && right[index] !== 0 ? 1 : 0;
    union += left[index] !== 0 || right[index] !== 0 ? 1 : 0;
  }
  return intersection / Math.max(1, union);
}

export function analyzeLifecycleOverlayComposites({ terrain, baseLayers, homeActor, warmOverlay, hoardOverlay, warmComposites, hoardComposites }) {
  assertImage(terrain, "terrain");
  assertImage(homeActor, "homeActor");
  assertImage(warmOverlay, "warmOverlay");
  assertImage(hoardOverlay, "hoardOverlay");
  if (!Array.isArray(baseLayers) || baseLayers.length !== 2 || !Array.isArray(warmComposites)
      || warmComposites.length !== 2 || !Array.isArray(hoardComposites) || hoardComposites.length !== 2) {
    throw new TypeError("exactly two standing bases and two composites per overlay are required");
  }
  const warm = [];
  const hoard = [];
  const flattenErrors = [];
  for (let index = 0; index < 2; index += 1) {
    const base = baseLayers[index];
    for (const [label, image] of Object.entries({ base, warmComposite: warmComposites[index], hoardComposite: hoardComposites[index] })) {
      assertImage(image, label);
      if (image.width !== terrain.width || image.height !== terrain.height) throw new RangeError(`${label} geometry mismatch`);
    }
    const baseline = compositeRgbaLayers(terrain, [base, homeActor]);
    const expectedWarm = compositeRgbaLayers(terrain, [base, warmOverlay, homeActor]);
    const expectedHoard = compositeRgbaLayers(terrain, [base, hoardOverlay, homeActor]);
    if (!imageByteDifference(expectedWarm, warmComposites[index]).exact) flattenErrors.push(`warm/base-${index}`);
    if (!imageByteDifference(expectedHoard, hoardComposites[index]).exact) flattenErrors.push(`hoard/base-${index}`);
    warm.push(compositeDeltaMetrics(baseline, warmComposites[index], warmOverlay));
    hoard.push(compositeDeltaMetrics(baseline, hoardComposites[index], hoardOverlay));
  }
  return {
    warm: warm.map(({ changed: _changed, ...value }) => value),
    hoard: hoard.map(({ changed: _changed, ...value }) => value),
    warmHoardIoUByBase: warm.map((value, index) => maskIoU(value.changed, hoard[index].changed)),
    warmHoardIoU: Math.max(...warm.map((value, index) => maskIoU(value.changed, hoard[index].changed))),
    flattenErrors,
  };
}

export function validateLifecycleOverlayMetrics(input) {
  if (!input || Object.keys(input).some((key) => /threshold|denominator|claimed|mask|exclusion/i.test(key))) {
    return ["overlay-contract: candidate masks, thresholds, denominators, and claims are forbidden"];
  }
  let value;
  try {
    value = analyzeLifecycleOverlayComposites(input);
  } catch (error) {
    return [`overlay-contract: malformed RGBA layers (${error.message})`];
  }
  const errors = [];
  if (value.flattenErrors.length > 0) errors.push(`overlay-exact-flatten: ${value.flattenErrors.join(" ")}`);
  for (const [kind, lower, upper] of [["warm", 0.005, 0.10], ["hoard", 0.01, 0.15]]) {
    for (const [index, metrics] of value[kind].entries()) {
      if (metrics.deltaShare < lower) errors.push(`overlay-composite-delta: ${kind}/base-${index} ${metrics.deltaShare.toFixed(4)} < ${lower}`);
      if (metrics.deltaShare > upper) errors.push(`overlay-localization: ${kind}/base-${index} ${metrics.deltaShare.toFixed(4)} > ${upper}`);
      if (metrics.visibleAlphaShare < 0.85) errors.push(`overlay-visibility: ${kind}/base-${index} ${metrics.visibleAlphaShare.toFixed(4)} < 0.85`);
      if (metrics.rms < 8) errors.push(`overlay-rms: ${kind}/base-${index} ${metrics.rms.toFixed(4)} < 8`);
      if (metrics.largestComponentShare < 0.35) errors.push(`overlay-connectivity: ${kind}/base-${index} largest ${metrics.largestComponentShare.toFixed(4)} < 0.35`);
      if (metrics.tinyComponentShare > 0.08) errors.push(`overlay-connectivity: ${kind}/base-${index} tiny ${metrics.tinyComponentShare.toFixed(4)} > 0.08`);
    }
  }
  if (value.warmHoardIoU > 0.65) errors.push(`overlay-semantic-separation: warm/hoard IoU ${value.warmHoardIoU.toFixed(4)} > 0.65`);
  return errors;
}

function compositeRgbaLayers(baseLayer, layers) {
  assertImage(baseLayer, "baseLayer");
  const result = { width: baseLayer.width, height: baseLayer.height, data: Buffer.from(baseLayer.data) };
  for (const [index, layer] of layers.entries()) {
    assertImage(layer, `layers[${index}]`);
    if (layer.width !== result.width || layer.height !== result.height) throw new RangeError(`layers[${index}] geometry mismatch`);
    for (let pixel = 0; pixel < result.width * result.height; pixel += 1) {
      const offset = pixel * 4;
      const alpha = layer.data[offset + 3];
      if (alpha === 0) continue;
      if (alpha !== 255) throw new RangeError(`layers[${index}] alpha must be binary`);
      for (let channel = 0; channel < 4; channel += 1) result.data[offset + channel] = layer.data[offset + channel];
    }
  }
  return result;
}

function imageByteDifference(left, right) {
  assertImage(left, "left image");
  assertImage(right, "right image");
  if (left.width !== right.width || left.height !== right.height) return { differentPixels: Infinity, exact: false };
  let differentPixels = 0;
  for (let pixel = 0; pixel < left.width * left.height; pixel += 1) {
    let differs = false;
    for (let channel = 0; channel < 4; channel += 1) differs ||= left.data[pixel * 4 + channel] !== right.data[pixel * 4 + channel];
    differentPixels += differs ? 1 : 0;
  }
  return { differentPixels, exact: differentPixels === 0 };
}

function omitOneVisibility(baseLayer, orderedLayers, fullScene, omittedIndex) {
  const omitted = compositeRgbaLayers(baseLayer, orderedLayers.filter((_layer, index) => index !== omittedIndex));
  const sourceMask = alphaMask(orderedLayers[omittedIndex]);
  let sourcePixels = 0;
  let visibleDeltaPixels = 0;
  for (let pixel = 0; pixel < sourceMask.length; pixel += 1) {
    if (sourceMask[pixel] === 0) continue;
    sourcePixels += 1;
    let differs = false;
    for (let channel = 0; channel < 4; channel += 1) differs ||= omitted.data[pixel * 4 + channel] !== fullScene.data[pixel * 4 + channel];
    visibleDeltaPixels += differs ? 1 : 0;
  }
  return { sourcePixels, visibleDeltaPixels, visibleShare: visibleDeltaPixels / Math.max(1, sourcePixels) };
}

function extractRgbaRect(image, rect) {
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > image.width || rect.y + rect.height > image.height) throw new RangeError("trusted source rect is out of bounds");
  const data = Buffer.alloc(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y += 1) {
    const start = ((rect.y + y) * image.width + rect.x) * 4;
    image.data.copy(data, y * rect.width * 4, start, start + rect.width * 4);
  }
  return { data, width: rect.width, height: rect.height };
}

function placeRgbaCell(cell, sceneWidth, sceneHeight, destination) {
  const layer = { data: Buffer.alloc(sceneWidth * sceneHeight * 4), width: sceneWidth, height: sceneHeight };
  if (destination.x < 0 || destination.y < 0 || destination.x + cell.width > sceneWidth || destination.y + cell.height > sceneHeight) throw new RangeError("trusted destination is out of bounds");
  for (let y = 0; y < cell.height; y += 1) {
    cell.data.copy(layer.data, ((destination.y + y) * sceneWidth + destination.x) * 4, y * cell.width * 4, (y + 1) * cell.width * 4);
  }
  return layer;
}

async function decodePinnedSourceLayers(contract, sourcePngBytes) {
  if (!Buffer.isBuffer(sourcePngBytes)) throw new TypeError("source PNG bytes missing");
  if (hashBytes(sourcePngBytes) !== contract.pngSha256) throw new Error("source PNG digest mismatch");
  const decoded = await sharp(sourcePngBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== contract.width || decoded.info.height !== contract.height) throw new Error("source PNG geometry mismatch");
  const atlas = { data: decoded.data, width: decoded.info.width, height: decoded.info.height };
  const layers = contract.layers.map((descriptor) => {
    const cell = extractRgbaRect(atlas, descriptor.rect);
    if (hashBytes(cell.data) !== descriptor.rgbaSha256) throw new Error(`${descriptor.id} source cell digest mismatch`);
    return { ...descriptor, layer: placeRgbaCell(cell, contract.sceneWidth, contract.sceneHeight, descriptor.destination) };
  });
  return { atlas, layers };
}

async function reconstructTrustedRow(registry, rowId, sourcePngBytes) {
  const contract = ownRegistryRow(registry, rowId);
  if (!contract) return null;
  if (!isDeepFrozen(contract) || !Array.isArray(contract.layerInventory) || !Array.isArray(contract.roleInventory)) {
    throw new Error("trusted row, inventories, descriptors, rectangles, and destinations must be recursively frozen");
  }
  const descriptorIds = contract.layers.map(({ id }) => id);
  const descriptorRoles = contract.layers.map(({ role }) => role);
  if (new Set(descriptorIds).size !== descriptorIds.length
      || descriptorIds.length !== contract.layerInventory.length
      || descriptorIds.some((id, index) => id !== contract.layerInventory[index])
      || descriptorRoles.length !== contract.roleInventory.length
      || descriptorRoles.some((role, index) => role !== contract.roleInventory[index])) {
    throw new Error("trusted layer and semantic role order do not exactly match descriptors");
  }
  const reconstructed = await decodePinnedSourceLayers(contract, sourcePngBytes);
  if (reconstructed.layers.length !== contract.layerInventory.length) throw new Error("decoded layer inventory is incomplete");
  return { contract, ...reconstructed };
}

function lifecycleMetricInputFromLayers(layers) {
  const byRole = new Map(layers.map(({ role, layer }) => [role, layer]));
  const required = ["terrain", "base-a", "base-b", "home-actor", "warm-overlay", "hoard-overlay", "warm-a", "warm-b", "hoard-a", "hoard-b"];
  if (layers.length !== required.length || required.some((role) => !byRole.has(role))) throw new Error("exact lifecycle layer inventory is required");
  return {
    terrain: byRole.get("terrain"),
    baseLayers: [byRole.get("base-a"), byRole.get("base-b")],
    homeActor: byRole.get("home-actor"),
    warmOverlay: byRole.get("warm-overlay"),
    hoardOverlay: byRole.get("hoard-overlay"),
    warmComposites: [byRole.get("warm-a"), byRole.get("warm-b")],
    hoardComposites: [byRole.get("hoard-a"), byRole.get("hoard-b")],
  };
}

async function lifecycleAuthorityBindings(lifecycleTrusted, input, terrainRegistry, homeRegistry) {
  const { contract } = lifecycleTrusted;
  let terrainTrusted;
  try {
    terrainTrusted = await reconstructTrustedRow(terrainRegistry, contract.terrainAuthorityRowId, input.terrainSourcePngBytes);
  } catch (error) {
    throw new Error(`terrain-source-reconstruction-mismatch: ${error.message}`);
  }
  if (!terrainTrusted) throw new Error("terrain-source-reconstruction-mismatch: trusted terrain authority row missing");
  let homeTrusted;
  try {
    homeTrusted = await reconstructTrustedRow(homeRegistry, contract.homeActorAuthorityRowId, input.homeActorSourcePngBytes);
  } catch (error) {
    throw new Error(`home-actor-source-reconstruction-mismatch: ${error.message}`);
  }
  if (!homeTrusted) throw new Error("home-actor-source-reconstruction-mismatch: trusted core HomeActor authority row missing");
  if (terrainTrusted.layers.length !== 1 || terrainTrusted.layers[0].role !== "terrain-atlas") throw new Error("terrain-source-inventory-mismatch: exact terrain atlas role required");
  if (homeTrusted.layers.length !== 1 || homeTrusted.layers[0].role !== "home-actor") throw new Error("home-actor-source-inventory-mismatch: exact HomeActor role required");
  const topLevelTerrain = input.topLevelTerrain;
  assertImage(topLevelTerrain, "top-level terrain atlas");
  if (topLevelTerrain.width !== 256 || topLevelTerrain.height !== 256 || !imageByteDifference(topLevelTerrain, terrainTrusted.atlas).exact) {
    throw new Error("terrain-source-binding-mismatch: top-level terrain differs from exact 256x256 trusted atlas");
  }
  const metricInput = lifecycleMetricInputFromLayers(lifecycleTrusted.layers);
  const terrainPreview = extractRgbaRect(terrainTrusted.atlas, contract.terrainPreviewRect);
  if (!imageByteDifference(terrainPreview, metricInput.terrain).exact) throw new Error("terrain-preview-binding-mismatch: lifecycle terrain is detached from canonical atlas crop");
  if (!imageByteDifference(homeTrusted.layers[0].layer, metricInput.homeActor).exact) throw new Error("home-actor-binding-mismatch: lifecycle HomeActor differs from independently pinned core source");
  assertImage(input.topLevelHomeActor, "top-level HomeActor authority");
  if (!imageByteDifference(input.topLevelHomeActor, homeTrusted.layers[0].layer).exact) {
    throw new Error("home-actor-binding-mismatch: top-level HomeActor differs from independently pinned core source");
  }
  assertImage(input.yards, "top-level yards");
  const boundCells = [0, 1, 2, 3].map((cell) => copyCell(input.yards, cell, 5, 192, 160));
  for (const [index, expected] of [metricInput.baseLayers[0], metricInput.baseLayers[1], metricInput.warmOverlay, metricInput.hoardOverlay].entries()) {
    if (!imageByteDifference(boundCells[index], expected).exact) {
      throw new Error("lifecycle-yard-binding-mismatch: trusted lifecycle layer differs from top-level yard cell");
    }
  }
  assertImage(input.composedScene, "aggregate composed scene");
  const expectedBaseline = compositeRgbaLayers(metricInput.terrain, [
    contract.composedBaseRole === "base-b" ? metricInput.baseLayers[1] : metricInput.baseLayers[0],
    metricInput.homeActor,
  ]);
  const aggregateCrop = extractRgbaRect(input.composedScene, contract.composedCrop);
  if (!imageByteDifference(aggregateCrop, expectedBaseline).exact) throw new Error("lifecycle-composed-crop-mismatch: reviewed aggregate crop differs from terrain/base/HomeActor baseline");
  if (!contract.composedSceneRgbaSha256 || hashBytes(input.composedScene.data) !== contract.composedSceneRgbaSha256) {
    throw new Error("lifecycle-composed-binding-mismatch: aggregate composed scene differs from trusted authority");
  }
  return metricInput;
}

export async function validateLifecycleOverlayComposites(input) {
  if (!input || typeof input !== "object") return ["lifecycle-source-descriptor-missing: no reviewed R5 lifecycle source contract"];
  const contract = ownRegistryRow(R5_TRUSTED_LIFECYCLE_SOURCE_CONTRACTS, input.kit);
  if (!contract) return ["lifecycle-source-descriptor-missing: no reviewed R5 lifecycle source contract"];
  if (["terrain", "baseLayers", "homeActor", "warmOverlay", "hoardOverlay", "warmComposites", "hoardComposites", "sourceDescriptors"].some((key) => Object.hasOwn(input, key))) {
    return ["lifecycle-source-contract: candidate lifecycle layers and descriptors are forbidden"];
  }
  let trusted;
  try {
    trusted = await reconstructTrustedRow(R5_TRUSTED_LIFECYCLE_SOURCE_CONTRACTS, input.kit, input.sourcePngBytes);
    const metricInput = await lifecycleAuthorityBindings(trusted, input, R5_TRUSTED_TERRAIN_SOURCE_CONTRACTS, R5_TRUSTED_HOME_ACTOR_SOURCE_CONTRACTS);
    return validateLifecycleOverlayMetrics(metricInput);
  } catch (error) {
    return [`lifecycle-source-reconstruction-mismatch: ${error.message}`];
  }
}

export async function validateSyntheticLifecycleOverlayControl(input) {
  if (!input || typeof input !== "object") return ["lifecycle-source-byte-missing: synthetic evidence missing"];
  const allowed = new Set(["sourcePngBytes", "terrainSourcePngBytes", "homeActorSourcePngBytes", "topLevelTerrain", "topLevelHomeActor", "yards", "composedScene"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) return ["synthetic-lifecycle-source-contract: candidate lifecycle layers are forbidden"];
  try {
    const trusted = await reconstructTrustedRow(R5_SYNTHETIC_TRUSTED_SOURCE_ROWS, "synthetic-lifecycle", input.sourcePngBytes);
    const metricInput = await lifecycleAuthorityBindings(trusted, input, R5_SYNTHETIC_TRUSTED_SOURCE_ROWS, R5_SYNTHETIC_TRUSTED_SOURCE_ROWS);
    return validateLifecycleOverlayMetrics(metricInput);
  } catch (error) {
    if (/terrain-source-reconstruction-mismatch/.test(error.message)) return [error.message];
    if (/missing/.test(error.message)) return [`lifecycle-source-byte-missing: ${error.message}`];
    return [`lifecycle-source-reconstruction-mismatch: ${error.message}`];
  }
}

export function analyzeConstructedCluster({ width, height, baseLayer, scene, landmarkLayer, supportLayers = [], routeLayer }) {
  for (const [label, image] of Object.entries({ baseLayer, scene, landmarkLayer, routeLayer })) {
    assertImage(image, label);
    if (image.width !== width || image.height !== height) throw new RangeError(`${label} geometry mismatch`);
  }
  if (!Array.isArray(supportLayers)) throw new TypeError("supportLayers must be an array");
  for (const [index, layer] of supportLayers.entries()) {
    assertImage(layer, `supportLayers[${index}]`);
    if (layer.width !== width || layer.height !== height) throw new RangeError(`supportLayers[${index}] geometry mismatch`);
  }
  const landmark = alphaMask(landmarkLayer);
  const route = alphaMask(routeLayer);
  const supports = supportLayers.map(alphaMask);
  const saliency = Uint8Array.from(landmark);
  for (const support of supports) for (let index = 0; index < saliency.length; index += 1) saliency[index] ||= support[index];
  const saliencyPixels = saliency.reduce((sum, value) => sum + value, 0);
  const supportPixels = supports.reduce((sum, support) => sum + support.reduce((inner, value) => inner + value, 0), 0);
  const isolatedSupportPixels = supports.reduce((sum, support) => {
    if (masksTouch(support, landmark, width, height, 1) || masksTouch(support, route, width, height, 1)) return sum;
    return sum + support.reduce((inner, value) => inner + value, 0);
  }, 0);
  const undilatedComponents = maskComponents(saliency, width, height);
  const dilatedSaliency = dilate(saliency, width, height, 1);
  const saliencyComponents = maskComponents(dilatedSaliency, width, height);
  const largest = Math.max(0, ...undilatedComponents.map(({ pixels }) => pixels));
  const orderedLayers = [routeLayer, landmarkLayer, ...supportLayers];
  const flattened = compositeRgbaLayers(baseLayer, orderedLayers);
  const omitOne = orderedLayers.map((_layer, index) => omitOneVisibility(baseLayer, orderedLayers, flattened, index));
  const nodeMasks = [landmark, ...supports, route];
  const adjacency = nodeMasks.map(() => []);
  for (let left = 0; left < nodeMasks.length; left += 1) for (let right = left + 1; right < nodeMasks.length; right += 1) {
    if (!masksTouch(nodeMasks[left], nodeMasks[right], width, height, 1)) continue;
    adjacency[left].push(right);
    adjacency[right].push(left);
  }
  const reached = new Set([0]);
  const queue = [0];
  while (queue.length > 0) {
    const node = queue.shift();
    for (const neighbor of adjacency[node]) if (!reached.has(neighbor)) {
      reached.add(neighbor);
      queue.push(neighbor);
    }
  }
  return {
    supportCount: supports.length,
    joinedToLandmarkCount: supports.filter((support) => masksTouch(support, landmark, width, height, 1)).length,
    joinedToRouteCount: supports.filter((support) => masksTouch(support, route, width, height, 1)).length,
    saliencyComponentCount: saliencyComponents.length,
    undilatedComponentCount: undilatedComponents.length,
    dominantMassShare: largest / Math.max(1, saliencyPixels),
    isolatedSupportPixelShare: isolatedSupportPixels / Math.max(1, supportPixels),
    negativeWalkableShare: 1 - saliencyPixels / (width * height),
    exactFlatten: imageByteDifference(flattened, scene).exact,
    omitOne,
    allNodesInLandmarkRouteGraph: reached.size === nodeMasks.length && reached.has(nodeMasks.length - 1),
    supportComponentCounts: supports.map((support) => maskComponents(support, width, height).length),
    supportCoverages: supports.map((support) => support.reduce((sum, value) => sum + value, 0) / (width * height)),
    supportAnatomy: supports.map((support) => {
      const bounds = boundsForMask(support, width, height);
      return { pixels: bounds.pixels, width: bounds.width, height: bounds.height };
    }),
  };
}

function constructedClusterMetricErrors(value, label = "pickup-scatter") {
  const errors = [];
  if (value.supportCount < 2) errors.push(`${label}: fewer than two support masses`);
  if (value.joinedToLandmarkCount < 1) errors.push(`${label}: no support joins landmark`);
  if (value.joinedToRouteCount < 1) errors.push(`${label}: no support joins route or terrain material`);
  if (!value.allNodesInLandmarkRouteGraph) errors.push(`cluster-graph: every support must belong to the one-pixel landmark-to-route graph`);
  if (value.saliencyComponentCount > 2) errors.push(`${label}: ${value.saliencyComponentCount} radius-one saliency components > 2`);
  if (value.dominantMassShare < 0.5) errors.push(`${label}: largest undilated component share ${value.dominantMassShare.toFixed(4)} < 0.50`);
  if (value.isolatedSupportPixelShare > 0.15) errors.push(`${label}: isolated support share ${value.isolatedSupportPixelShare.toFixed(4)} > 0.15`);
  if (value.negativeWalkableShare < 0.3) errors.push(`${label}: negative walkable space ${value.negativeWalkableShare.toFixed(4)} < 0.30`);
  if (!value.exactFlatten) errors.push("cluster-exact-flatten: composed scene differs from exact RGBA layer flatten");
  for (const [index, visibility] of value.omitOne.entries()) if (visibility.visibleShare < 0.75) errors.push(`cluster-omit-one: layer ${index} visible alpha ${visibility.visibleShare.toFixed(4)} < 0.75`);
  for (const [index, count] of value.supportComponentCounts.entries()) if (count !== 1) errors.push(`support anatomy disconnected: support ${index} has ${count} components`);
  for (const [index, coverage] of value.supportCoverages.entries()) if (coverage > 0.15) errors.push(`generic-ground support: support ${index} coverage ${coverage.toFixed(4)} > 0.15`);
  for (const [index, anatomy] of value.supportAnatomy.entries()) {
    if (anatomy.pixels < 48 || anatomy.width < 6 || anatomy.height < 6) errors.push(`cluster-support-anatomy: support ${index} is ${anatomy.pixels}px/${anatomy.width}x${anatomy.height}, below 48px/6x6`);
  }
  return errors;
}

export function validateConstructedClusterMetrics(input, label = "pickup-scatter") {
  if (!input || Object.keys(input).some((key) => /(?:^|_)(?:landmark|support|route)?mask|threshold|denominator|dilation|exclusion|source|trust/i.test(key))) {
    return ["candidate masks, thresholds, or denominators are forbidden"];
  }
  let value;
  try {
    value = analyzeConstructedCluster(input);
  } catch (error) {
    const field = /landmarkLayer/.test(error.message) ? "landmarkLayer" : /supportLayers/.test(error.message) ? "supportLayers" : "input";
    return [`cluster-layer-binding: ${field} ${error.message}`];
  }
  return constructedClusterMetricErrors(value, label);
}

export async function validateConstructedCluster(input, label = "pickup-scatter") {
  if (!input || typeof input !== "object") return ["cluster-source-descriptor-missing: no reviewed R5 scenery source contract"];
  const contract = ownRegistryRow(R5_TRUSTED_SCENERY_SOURCE_CONTRACTS, input.kit);
  if (!contract) return ["cluster-source-descriptor-missing: no reviewed R5 scenery source contract"];
  if (["landmarkLayer", "supportLayers", "routeLayer", "sourceDescriptors", "layerInventory"].some((key) => Object.hasOwn(input, key))
      || Object.keys(input).some((key) => /mask|threshold|denominator|dilation|exclusion|claimed|trust/i.test(key))) {
    return ["cluster-source-contract: candidate layers, descriptors, masks, thresholds, and claims are forbidden"];
  }
  let trusted;
  try {
    trusted = await reconstructTrustedRow(R5_TRUSTED_SCENERY_SOURCE_CONTRACTS, input.kit, input.sourcePngBytes);
  } catch (error) {
    return [`cluster-source-reconstruction-mismatch: ${error.message}`];
  }
  const { atlas, layers } = trusted;
  try {
    assertImage(input.scenery, "top-level scenery");
    if (!imageByteDifference(atlas, input.scenery).exact) return ["cluster-source-atlas-mismatch: top-level scenery differs from pinned atlas bytes"];
    assertImage(input.baseLayer, "trusted cluster base");
    assertImage(input.scene, "trusted cluster scene");
  } catch (error) {
    return [`cluster-source-reconstruction-mismatch: ${error.message}`];
  }
  if (!contract.baseRgbaSha256 || hashBytes(input.baseLayer.data) !== contract.baseRgbaSha256) return ["cluster-base-authority-mismatch: base pixels differ from trusted row"];
  if (!contract.sceneRgbaSha256 || hashBytes(input.scene.data) !== contract.sceneRgbaSha256) return ["cluster-scene-authority-mismatch: full scene pixels differ from trusted row"];
  if (input.scene.width !== 768 || input.scene.height !== 512) return ["cluster-scene-authority-mismatch: production scene must be exact 768x512"];
  const routeLayers = layers.filter(({ role }) => role === "route");
  const landmarkLayers = layers.filter(({ role }) => role === "landmark");
  const supportLayers = layers.filter(({ role }) => role === "support");
  if (routeLayers.length !== 1 || landmarkLayers.length !== 1 || supportLayers.length < 2
      || routeLayers.length + landmarkLayers.length + supportLayers.length !== layers.length) {
    return ["cluster-source-inventory-mismatch: exact route/landmark/support layer inventory is required"];
  }
  const metricInput = {
    width: contract.sceneWidth,
    height: contract.sceneHeight,
    baseLayer: input.baseLayer,
    scene: input.scene,
    routeLayer: routeLayers[0].layer,
    landmarkLayer: landmarkLayers[0].layer,
    supportLayers: supportLayers.map(({ layer }) => layer),
  };
  try {
    return constructedClusterMetricErrors(analyzeConstructedCluster(metricInput), label);
  } catch (error) {
    return [`cluster-source-reconstruction-mismatch: ${error.message}`];
  }
}

export async function validateSyntheticConstructedClusterControl(input) {
  if (!input || typeof input !== "object") return ["cluster-source-byte-missing: synthetic evidence missing"];
  if (Object.hasOwn(input, "sourceDescriptors")) return ["candidate source descriptors are forbidden"];
  if (["landmarkLayer", "supportLayers", "routeLayer", "layerInventory", "roleInventory"].some((key) => Object.hasOwn(input, key))) {
    return ["candidate layers and inventory are forbidden"];
  }
  let trusted;
  try {
    trusted = await reconstructTrustedRow(R5_SYNTHETIC_TRUSTED_SOURCE_ROWS, "synthetic-cluster", input.sourcePngBytes);
  } catch (error) {
    if (/missing/.test(error.message)) return [`cluster-source-byte-missing: ${error.message}`];
    return [`cluster-source-digest-mismatch: ${error.message}`];
  }
  const { contract, layers } = trusted;
  if (hashBytes(input.baseLayer?.data ?? Buffer.alloc(0)) !== contract.baseRgbaSha256) return ["cluster-base-authority-mismatch: base pixels differ from pinned authority"];
  if (hashBytes(input.scene?.data ?? Buffer.alloc(0)) !== contract.sceneRgbaSha256) return ["cluster-scene-authority-mismatch: full scene pixels differ from pinned authority"];
  const routeLayer = layers.find(({ role }) => role === "route").layer;
  const landmarkLayer = layers.find(({ role }) => role === "landmark").layer;
  const supportLayers = layers.filter(({ role }) => role === "support").map(({ layer }) => layer);
  try {
    const value = analyzeConstructedCluster({
      width: SYNTHETIC_SCENERY_SOURCE_CONTRACT.sceneWidth,
      height: SYNTHETIC_SCENERY_SOURCE_CONTRACT.sceneHeight,
      baseLayer: input.baseLayer,
      scene: input.scene,
      routeLayer,
      landmarkLayer,
      supportLayers,
    });
    return constructedClusterMetricErrors(value, "synthetic-cluster");
  } catch (error) {
    return [`cluster-source-reconstruction-mismatch: ${error.message}`];
  }
}

function structuralWitnessValid(type, value, serviceMask = null) {
  const components = maskComponents(value.data, value.width, value.height);
  const bounds = boundsForMask(value.data, value.width, value.height);
  if (type === "pylon-lattice") {
    let tallColumns = 0;
    let crossRows = 0;
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      let count = 0;
      for (let y = bounds.minY; y <= bounds.maxY; y += 1) count += value.data[y * value.width + x];
      if (count >= bounds.height * 0.6) tallColumns += 1;
    }
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      let count = 0;
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) count += value.data[y * value.width + x];
      if (count >= bounds.width * 0.6) crossRows += 1;
    }
    const footBand = new Uint8Array(value.data.length);
    for (let y = Math.max(bounds.minY, bounds.maxY - 11); y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) footBand[y * value.width + x] = value.data[y * value.width + x];
    }
    const feet = maskComponents(footBand, value.width, value.height).filter(({ width, height }) => width >= 6 && height >= 4);
    const footCenters = feet.map((foot) => (foot.minX + foot.maxX) / 2).sort((left, right) => left - right);
    const separatedFeet = footCenters.some((left, index) => footCenters.slice(index + 1).some((right) => right - left >= 24));
    let longestRun = 0;
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      let run = 0;
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        run = value.data[y * value.width + x] ? run + 1 : 0;
        longestRun = Math.max(longestRun, run);
      }
    }
    return bounds.width >= 64 && bounds.height >= 80 && components.length === 1 && tallColumns >= 2
      && crossRows >= 2 && longestRun >= 32 && feet.length >= 2 && separatedFeet
      && serviceMask !== null && masksTouch(value.data, serviceMask, value.width, value.height, 1);
  }
  if (type === "cable-run") return bounds.width >= 32 && bounds.width >= bounds.height * 4 && components.length <= 8;
  if (type === "containment-relief") return bounds.width >= 24 && bounds.height >= 24 && bounds.pixels / (bounds.width * bounds.height) >= 0.35;
  if (type === "service-slab") return bounds.width >= 64 && bounds.height >= 8 && bounds.width >= bounds.height * 4 && components.length === 1;
  return false;
}

export function analyzeAshIndustrialWitnesses({ width, height, baseLayer, scene, witnesses = [] }) {
  const required = ["pylon-lattice", "cable-run", "containment-relief", "service-slab"];
  assertImage(baseLayer, "baseLayer");
  assertImage(scene, "scene");
  if (baseLayer.width !== width || baseLayer.height !== height || scene.width !== width || scene.height !== height) throw new RangeError("ash base/scene geometry mismatch");
  const measured = witnesses.map((witness, index) => {
    assertImage(witness.layer, `witnesses[${index}].layer`);
    if (witness.layer.width !== width || witness.layer.height !== height) throw new RangeError(`witnesses[${index}].layer geometry mismatch`);
    const data = alphaMask(witness.layer);
    const value = { data, width, height };
    const bounds = boundsForMask(data, width, height);
    return { type: witness.type, pixels: bounds.pixels, bounds, data, layer: witness.layer };
  });
  const serviceMask = measured.find(({ type }) => type === "service-slab")?.data ?? null;
  for (const value of measured) value.structurallyValid = structuralWitnessValid(value.type, { data: value.data, width, height }, serviceMask);
  const orderedLayers = measured.map(({ layer }) => layer);
  const flattened = compositeRgbaLayers(baseLayer, orderedLayers);
  const omitOne = orderedLayers.map((_layer, index) => omitOneVisibility(baseLayer, orderedLayers, flattened, index));
  const forbidden = new Set(R5_ASH_FORBIDDEN_RGB.map((color) => color.join(",")));
  const unauthorized = new Set();
  let forbiddenPixels = 0;
  for (const image of [baseLayer, ...orderedLayers]) for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    if (image.data[offset + 3] === 0) continue;
    const key = `${image.data[offset]},${image.data[offset + 1]},${image.data[offset + 2]}`;
    if (forbidden.has(key)) forbiddenPixels += 1;
    if (!R5_ASH_ALLOWED_RGB.includes(key)) unauthorized.add(key);
  }
  const pylon = measured.find(({ type }) => type === "pylon-lattice")?.data ?? null;
  const cable = measured.find(({ type }) => type === "cable-run")?.data ?? null;
  const relief = measured.find(({ type }) => type === "containment-relief")?.data ?? null;
  return {
    requiredTypeCount: required.filter((type) => measured.some((value) => value.type === type)).length,
    structurallyValidCount: required.filter((type) => measured.some((value) => value.type === type && value.structurallyValid)).length,
    witnesses: measured.map(({ data: _data, layer: _layer, ...value }) => value),
    exactFlatten: imageByteDifference(flattened, scene).exact,
    omitOne,
    forbiddenPixels,
    unauthorizedColors: [...unauthorized].sort(),
    cableConnectedToPylon: pylon !== null && cable !== null && masksTouch(cable, pylon, width, height, 1),
    serviceConnectedToPylon: pylon !== null && serviceMask !== null && masksTouch(serviceMask, pylon, width, height, 1),
    reliefBraceConnected: pylon !== null && relief !== null && masksTouch(relief, pylon, width, height, 1),
    reliefRgbaSha256: measured.find(({ type }) => type === "containment-relief")?.layer
      ? hashBytes(measured.find(({ type }) => type === "containment-relief").layer.data) : null,
  };
}

export function validateAshIndustrialMetrics(input, label = "ash-structural-preflight") {
  const errors = [];
  if (!input || Object.keys(input).some((key) => /mask|threshold|denominator|claimed|exclusion|source|trust/i.test(key))) return [`${label}: candidate masks, thresholds, sources, and claims are forbidden`];
  let value;
  try {
    value = analyzeAshIndustrialWitnesses(input);
  } catch (error) {
    return [`${label}: malformed witness layer (${error.message})`];
  }
  if (value.requiredTypeCount !== 4) errors.push(`${label}: required pylon/cable/containment/service pixel witnesses missing`);
  for (const witness of value.witnesses) if (!witness.structurallyValid) errors.push(`${label}: ${witness.type} lacks required structural pixel anatomy`);
  if (value.structurallyValidCount !== 4) errors.push(`${label}: only ${value.structurallyValidCount}/4 structural witnesses pass`);
  if (!value.cableConnectedToPylon) errors.push(`${label}: cable is not connected to the pylon lattice`);
  if (!value.serviceConnectedToPylon) errors.push(`${label}: service slab is not connected to grounded pylon feet`);
  if (!value.reliefBraceConnected) errors.push(`${label}: containment relief is farther than one pixel from its brace`);
  if (!value.exactFlatten) errors.push("ash-exact-flatten: scene differs from exact source RGBA layer flatten");
  for (const [index, visibility] of value.omitOne.entries()) if (visibility.visibleShare < 0.75) errors.push(`ash-omit-one: layer ${index} visible alpha ${visibility.visibleShare.toFixed(4)} < 0.75`);
  if (value.forbiddenPixels > 0) errors.push(`ash-forbidden-living-water-palette: ${value.forbiddenPixels} pixels`);
  if (value.unauthorizedColors.length > 0) errors.push(`${label}: colors outside exact ash allowlist ${value.unauthorizedColors.join(" ")}`);
  return errors;
}

export async function validateAshIndustrialWitnesses(input, label = "ash-structural-preflight") {
  if (!input || typeof input !== "object") return ["ash-source-descriptor-missing: no reviewed R5 ash raster source contract"];
  const contract = ownRegistryRow(R5_TRUSTED_ASH_SOURCE_CONTRACTS, input.kit);
  if (!contract) return ["ash-source-descriptor-missing: no reviewed R5 ash raster source contract"];
  if (["witnesses", "sourceDescriptors", "layerInventory"].some((key) => Object.hasOwn(input, key))
      || Object.keys(input).some((key) => /mask|threshold|denominator|claimed|exclusion|trust/i.test(key))) {
    return [`${label}: candidate witness layers, descriptors, masks, thresholds, and claims are forbidden`];
  }
  let trusted;
  try {
    trusted = await reconstructTrustedRow(R5_TRUSTED_ASH_SOURCE_CONTRACTS, input.kit, input.sourcePngBytes);
  } catch (error) {
    return [`ash-source-reconstruction-mismatch: ${error.message}`];
  }
  const { atlas, layers } = trusted;
  try {
    assertImage(input.scenery, "top-level ash scenery");
    if (!imageByteDifference(atlas, input.scenery).exact) return ["ash-source-atlas-mismatch: top-level scenery differs from pinned atlas bytes"];
    assertImage(input.baseLayer, "trusted ash base");
    assertImage(input.scene, "trusted ash scene");
  } catch (error) {
    return [`ash-source-reconstruction-mismatch: ${error.message}`];
  }
  if (!contract.baseRgbaSha256 || hashBytes(input.baseLayer.data) !== contract.baseRgbaSha256) return ["ash-base-authority-mismatch: base pixels differ from trusted row"];
  if (!contract.sceneRgbaSha256 || hashBytes(input.scene.data) !== contract.sceneRgbaSha256) return ["ash-scene-authority-mismatch: full scene pixels differ from trusted row"];
  if (input.scene.width !== 768 || input.scene.height !== 512) return ["ash-scene-authority-mismatch: production scene must be exact 768x512"];
  const roleOrderErrors = validateAshSourceRoleOrder(contract, layers);
  if (roleOrderErrors.length > 0) return roleOrderErrors;
  const metricInput = {
    width: contract.sceneWidth,
    height: contract.sceneHeight,
    baseLayer: input.baseLayer,
    scene: input.scene,
    witnesses: layers.map(({ role, layer }) => ({ type: role, layer })),
  };
  const errors = validateAshIndustrialMetrics(metricInput, label);
  const reliefHash = hashBytes(layers.find(({ role }) => role === "containment-relief").layer.data);
  if (!contract.reliefRgbaSha256 || reliefHash !== contract.reliefRgbaSha256) errors.push(`${label}: containment relief literal RGBA hash mismatch`);
  return errors;
}

export async function validateSyntheticAshIndustrialControl(input) {
  if (!input || typeof input !== "object") return ["ash-source-byte-missing: synthetic evidence missing"];
  if (Object.hasOwn(input, "sourceDescriptors")) return ["candidate source descriptors are forbidden"];
  if (["witnesses", "layerInventory", "roleInventory"].some((key) => Object.hasOwn(input, key))) {
    return ["candidate layers and inventory are forbidden"];
  }
  let trusted;
  try {
    trusted = await reconstructTrustedRow(R5_SYNTHETIC_TRUSTED_SOURCE_ROWS, "synthetic-ash", input.sourcePngBytes);
  } catch (error) {
    if (/missing/.test(error.message)) return [`ash-source-byte-missing: ${error.message}`];
    return [`ash-source-digest-mismatch: ${error.message}`];
  }
  const { contract, layers } = trusted;
  const roleOrderErrors = validateAshSourceRoleOrder(contract, layers);
  if (roleOrderErrors.length > 0) return roleOrderErrors;
  if (hashBytes(input.baseLayer?.data ?? Buffer.alloc(0)) !== contract.baseRgbaSha256) return ["ash-base-authority-mismatch: base pixels differ from pinned authority"];
  if (hashBytes(input.scene?.data ?? Buffer.alloc(0)) !== contract.sceneRgbaSha256) return ["ash-scene-authority-mismatch: full scene pixels differ from pinned authority"];
  const witnesses = layers.map(({ role, layer }) => ({ type: role, layer }));
  const metricInput = {
    width: SYNTHETIC_ASH_SOURCE_CONTRACT.sceneWidth,
    height: SYNTHETIC_ASH_SOURCE_CONTRACT.sceneHeight,
    baseLayer: input.baseLayer,
    scene: input.scene,
    witnesses,
  };
  try {
    const value = analyzeAshIndustrialWitnesses(metricInput);
    const errors = validateAshIndustrialMetrics(metricInput, "synthetic-ash");
    if (value.reliefRgbaSha256 !== SYNTHETIC_ASH_SOURCE_CONTRACT.reliefRgbaSha256) {
      errors.push("synthetic-ash: containment relief literal RGBA hash mismatch");
    }
    return errors;
  } catch (error) {
    return [`ash-source-reconstruction-mismatch: ${error.message}`];
  }
}

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export const R5_HUMAN_ROLE_PLACEMENTS = Object.freeze({
  "worn-heartland": Object.freeze({ "route-entry": Object.freeze({ x: 24, y: 83 }), "defining-landmark": Object.freeze({ x: 72, y: 99 }), "shelter-door": Object.freeze({ x: 600, y: 371 }) }),
  "spring-terraces": Object.freeze({ "route-entry": Object.freeze({ x: 24, y: 211 }), "defining-landmark": Object.freeze({ x: 72, y: 227 }), "shelter-door": Object.freeze({ x: 568, y: 339 }) }),
  "dry-scrub": Object.freeze({ "route-entry": Object.freeze({ x: 696, y: 51 }), "defining-landmark": Object.freeze({ x: 552, y: 99 }), "shelter-door": Object.freeze({ x: 632, y: 307 }) }),
  "ash-waste": Object.freeze({ "route-entry": Object.freeze({ x: 120, y: 435 }), "defining-landmark": Object.freeze({ x: 328, y: 195 }), "shelter-door": Object.freeze({ x: 600, y: 339 }) }),
  "neutral-temperate": Object.freeze({ "route-entry": Object.freeze({ x: 248, y: 19 }), "defining-landmark": Object.freeze({ x: 168, y: 195 }), "shelter-door": Object.freeze({ x: 536, y: 371 }) }),
});

function validateHumanMetrics(input, trustedAuthority = null) {
  const errors = [];
  if (!input || typeof input !== "object") return ["human-scale-witness: candidate evidence object is required"];
  const { backgroundScene, scene, human, kit } = input;
  if (!scene || !backgroundScene || !human) return ["human-scale-witness: background scene, composed scene, and canonical production human RGBA are required"];
  const forbiddenCandidateFields = [
    "witnesses", "positions", "rolePlacements", "backgroundPatch", "backgroundPatches",
    "occlusionMask", "humanAssetId", "humanSha256",
  ];
  if (forbiddenCandidateFields.some((field) => Object.hasOwn(input, field))) {
    errors.push("human-scale-witness: candidate witness metadata and occlusion masks are forbidden");
  }
  try {
    assertImage(scene, "key scene");
    assertImage(backgroundScene, "key scene background");
    assertImage(human, "production human");
  } catch (error) {
    return [...errors, `human-scale-witness: malformed RGBA evidence (${error.message})`];
  }
  if (backgroundScene.width !== scene.width || backgroundScene.height !== scene.height) errors.push("human-scale-witness: background scene geometry mismatch");
  if (scene.width !== 768 || scene.height !== 512) errors.push("human-scale-witness: key scene must be exact 768x512 native pixels");
  if (human.width !== 48 || human.height !== 64) errors.push(`human-scale-witness: canonical production human is ${human.width}x${human.height}, expected 48x64`);
  const actualHumanHash = hashBytes(human.data);
  if (actualHumanHash !== R5_PRODUCTION_HUMAN_CONTRACT.canonicalPatchSha256) errors.push("human-scale-witness: canonical production human RGBA digest mismatch");
  const placements = R5_HUMAN_ROLE_PLACEMENTS[kit];
  if (!placements) return [...errors, "human-scale-witness: unknown kit has no trusted role anchors"];
  const trustedOccluder = trustedAuthority?.occluderLayer ?? null;
  if (trustedOccluder) {
    try {
      assertImage(trustedOccluder, "trusted human occluder");
      if (trustedOccluder.width !== scene.width || trustedOccluder.height !== scene.height) errors.push("human-source-occluder-mismatch: trusted occluder geometry differs from scene");
    } catch (error) {
      return [...errors, `human-source-occluder-mismatch: ${error.message}`];
    }
  }
  let unexpectedPostHumanPixels = 0;
  for (let pixel = 0; pixel < scene.width * scene.height; pixel += 1) {
    let differs = false;
    for (let channel = 0; channel < 4; channel += 1) {
      differs ||= scene.data[pixel * 4 + channel] !== backgroundScene.data[pixel * 4 + channel];
    }
    if (!differs) continue;
    const x = pixel % scene.width;
    const y = Math.floor(pixel / scene.width);
    const insideTrustedRole = R5_REQUIRED_HUMAN_WITNESS_ROLES.some((role) => {
      const placement = placements[role];
      return x >= placement.x && x < placement.x + 48 && y >= placement.y && y < placement.y + 64;
    });
    const trustedOccluderPixel = trustedOccluder?.data[pixel * 4 + 3] > 0;
    unexpectedPostHumanPixels += insideTrustedRole || trustedOccluderPixel ? 0 : 1;
  }
  if (unexpectedPostHumanPixels > 0) {
    errors.push(`human-scale-witness: ${unexpectedPostHumanPixels} post-human compositor pixels outside exactly three trusted roles`);
  }
  for (const role of R5_REQUIRED_HUMAN_WITNESS_ROLES) {
    const placement = placements[role];
    if (placement.x + R5_PRODUCTION_HUMAN_CONTRACT.feet.x < 0
        || placement.y + R5_PRODUCTION_HUMAN_CONTRACT.feet.y < 0
        || placement.x + 48 > scene.width || placement.y + 64 > scene.height) {
      errors.push(`human-role-anchor: ${kit}/${role} is out of bounds`);
      continue;
    }
    let humanOpaque = 0;
    let matchingHumanOpaque = 0;
    let missingOpaque = 0;
    let mismatched = 0;
    let transparentMismatched = 0;
    for (let y = 0; y < 64; y += 1) for (let x = 0; x < 48; x += 1) {
      const sourcePixel = y * 48 + x;
      const sourceOffset = sourcePixel * 4;
      const sceneOffset = ((placement.y + y) * scene.width + placement.x + x) * 4;
      if (human.data[sourceOffset + 3] === 0) {
        let matchesOccluder = trustedOccluder?.data[sceneOffset + 3] > 0;
        for (let channel = 0; channel < 4 && matchesOccluder; channel += 1) {
          matchesOccluder &&= scene.data[sceneOffset + channel] === trustedOccluder.data[sceneOffset + channel];
        }
        if (matchesOccluder) continue;
        for (let channel = 0; channel < 4; channel += 1) {
          if (scene.data[sceneOffset + channel] !== backgroundScene.data[sceneOffset + channel]) {
            transparentMismatched += 1;
            break;
          }
        }
        continue;
      }
      humanOpaque += 1;
      let matchesHuman = true;
      let matchesBackground = true;
      let matchesOccluder = trustedOccluder?.data[sceneOffset + 3] > 0;
      for (let channel = 0; channel < 4; channel += 1) {
        matchesHuman &&= scene.data[sceneOffset + channel] === human.data[sourceOffset + channel];
        matchesBackground &&= scene.data[sceneOffset + channel] === backgroundScene.data[sceneOffset + channel];
        if (matchesOccluder) matchesOccluder &&= scene.data[sceneOffset + channel] === trustedOccluder.data[sceneOffset + channel];
      }
      if (matchesHuman) {
        matchingHumanOpaque += 1;
        continue;
      }
      if (matchesOccluder) {
        continue;
      }
      if (matchesBackground) missingOpaque += 1;
      else mismatched += 1;
    }
    const visibleShare = matchingHumanOpaque / Math.max(1, humanOpaque);
    let nearbyAnchorFound = false;
    if (humanOpaque === 0 || visibleShare < 0.85 || mismatched > 0 || transparentMismatched > 0) {
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        let matches = 0;
        let samples = 0;
        for (let y = 0; y < 64; y += 1) for (let x = 0; x < 48; x += 1) {
          const sourceOffset = (y * 48 + x) * 4;
          if (human.data[sourceOffset + 3] === 0) continue;
          const sx = placement.x + dx + x;
          const sy = placement.y + dy + y;
          if (sx < 0 || sy < 0 || sx >= scene.width || sy >= scene.height) continue;
          samples += 1;
          const sceneOffset = (sy * scene.width + sx) * 4;
          let equal = true;
          for (let channel = 0; channel < 4; channel += 1) equal &&= scene.data[sceneOffset + channel] === human.data[sourceOffset + channel];
          matches += equal ? 1 : 0;
        }
        nearbyAnchorFound ||= matches / Math.max(1, samples) >= 0.85;
      }
    }
    if (nearbyAnchorFound) errors.push(`human-role-anchor: ${kit}/${role} canonical human is not at the trusted feet anchor`);
    else {
      if (humanOpaque === 0 || visibleShare < 0.85) errors.push(`human-scale-witness: ${role} visible compositor alpha ${visibleShare.toFixed(4)} < 0.85`);
      if (missingOpaque > 0) errors.push(`human-scale-witness: ${role} has ${missingOpaque} missing human pixels; background equality is untrusted occlusion`);
      if (mismatched > 0) errors.push(`human-scale-witness: ${role} pixels do not match canonical compositor RGBA (${mismatched})`);
      if (transparentMismatched > 0) errors.push(`human-scale-witness: ${role} transparent compositor pixels differ from exact background (${transparentMismatched})`);
    }
  }
  return errors;
}

export const R5_TRUSTED_HUMAN_BACKGROUND_CONTRACTS = closedRegistry();

function composeTrustedHumanScene(backgroundScene, human, placements, occluderLayer) {
  const scene = { ...backgroundScene, data: Buffer.from(backgroundScene.data) };
  for (const role of R5_REQUIRED_HUMAN_WITNESS_ROLES) {
    const placement = placements[role];
    for (let y = 0; y < human.height; y += 1) for (let x = 0; x < human.width; x += 1) {
      const sourceOffset = (y * human.width + x) * 4;
      if (human.data[sourceOffset + 3] === 0) continue;
      scene.data.set(human.data.subarray(sourceOffset, sourceOffset + 4), ((placement.y + y) * scene.width + placement.x + x) * 4);
    }
  }
  return compositeRgbaLayers(scene, [occluderLayer]);
}

async function validateHumanAgainstTrustedRows(registry, rowId, input) {
  const trusted = await reconstructTrustedRow(registry, rowId, input.sourcePngBytes);
  if (!trusted) return ["human-source-descriptor-missing: no reviewed R5 scene source contract"];
  const backgrounds = trusted.layers.filter(({ role }) => role === "background");
  const occluders = trusted.layers.filter(({ role }) => role === "occluder");
  if (backgrounds.length !== 1 || occluders.length !== 1 || trusted.layers.length !== 2) {
    return ["human-source-inventory-mismatch: exact background/post-human occluder inventory is required"];
  }
  try {
    assertImage(input.human, "canonical production human");
    assertImage(input.scene, "post-human scene");
  } catch (error) {
    return [`human-source-reconstruction-mismatch: ${error.message}`];
  }
  if (hashBytes(input.human.data) !== R5_PRODUCTION_HUMAN_CONTRACT.canonicalPatchSha256) {
    return ["human-scale-witness: canonical production human RGBA digest mismatch"];
  }
  const placements = R5_HUMAN_ROLE_PLACEMENTS[input.kit];
  if (!placements) return ["human-source-descriptor-missing: no reviewed R5 scene source contract"];
  const expectedScene = composeTrustedHumanScene(backgrounds[0].layer, input.human, placements, occluders[0].layer);
  const metricErrors = validateHumanMetrics({
    kit: input.kit,
    backgroundScene: backgrounds[0].layer,
    scene: input.scene,
    human: input.human,
  }, { occluderLayer: occluders[0].layer });
  const anchorErrors = metricErrors.filter((error) => error.startsWith("human-role-anchor"));
  if (anchorErrors.length > 0) return anchorErrors;
  if (!imageByteDifference(expectedScene, input.scene).exact) return ["human-source-post-human-mismatch: scene differs from trusted background/human/occluder order"];
  return metricErrors;
}

export async function validateProductionHumanWitnesses(input) {
  if (!input || typeof input !== "object") return ["human-source-descriptor-missing: no reviewed R5 scene source contract"];
  if (!ownRegistryRow(R5_TRUSTED_HUMAN_BACKGROUND_CONTRACTS, input.kit)) return ["human-source-descriptor-missing: no reviewed R5 scene source contract"];
  if (["backgroundScene", "occlusionMask", "backgroundPatch", "sourceDescriptors", "witnesses", "positions"].some((key) => Object.hasOwn(input, key))) {
    return ["human-source-contract: candidate backgrounds, occlusion, descriptors, and positions are forbidden"];
  }
  try {
    return await validateHumanAgainstTrustedRows(R5_TRUSTED_HUMAN_BACKGROUND_CONTRACTS, input.kit, input);
  } catch (error) {
    return [`human-source-reconstruction-mismatch: ${error.message}`];
  }
}

export async function validateSyntheticProductionHumanControl(input) {
  if (!input || typeof input !== "object") return ["synthetic-human-control: evidence missing"];
  if (["backgroundScene", "occlusionMask", "backgroundPatch", "sourceDescriptors", "witnesses", "positions"].some((key) => Object.hasOwn(input, key))) {
    return ["human-source-contract: candidate backgrounds, occlusion, descriptors, and positions are forbidden"];
  }
  if (!ownRegistryRow(R5_SYNTHETIC_TRUSTED_SOURCE_ROWS, input.controlId)) return ["human-source-descriptor-missing: unknown synthetic human authority"];
  try {
    return await validateHumanAgainstTrustedRows(R5_SYNTHETIC_TRUSTED_SOURCE_ROWS, input.controlId, input);
  } catch (error) {
    if (/missing/.test(error.message)) return [`human-source-byte-missing: ${error.message}`];
    return [`human-source-reconstruction-mismatch: ${error.message}`];
  }
}

function analyzePixelScatter(image) {
  const cellSize = 32;
  const foreground = new Uint8Array(image.width * image.height);
  for (let y0 = 0; y0 < image.height; y0 += cellSize) for (let x0 = 0; x0 < image.width; x0 += cellSize) {
    const frequencies = new Map();
    for (let y = y0; y < Math.min(image.height, y0 + cellSize); y += 1) for (let x = x0; x < Math.min(image.width, x0 + cellSize); x += 1) {
      const key = rgbaKey(image.data, (y * image.width + x) * 4);
      frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
    }
    const dominant = [...frequencies].sort((left, right) => right[1] - left[1])[0]?.[0];
    for (let y = y0; y < Math.min(image.height, y0 + cellSize); y += 1) for (let x = x0; x < Math.min(image.width, x0 + cellSize); x += 1) {
      if (rgbaKey(image.data, (y * image.width + x) * 4) !== dominant) foreground[y * image.width + x] = 1;
    }
  }
  const components = maskComponents(foreground, image.width, image.height);
  const pickups = components.filter((value) => value.pixels <= 512 && value.width <= 32 && value.height <= 32);
  return {
    saliencyComponents: components.length,
    pickupComponents: pickups.length,
    pickupComponentShare: pickups.length / Math.max(1, components.length),
    pickupPixelShare: pickups.reduce((sum, value) => sum + value.pixels, 0)
      / Math.max(1, components.reduce((sum, value) => sum + value.pixels, 0)),
  };
}

export const R5_STABLE_DIAGNOSTIC_NAMES = Object.freeze([
  "landmark-flat-material",
  "terrain-rgb-periodicity",
  "terrain-phase-locked-motif",
  "yard-three-sided-wrap",
  "yard-overlay-not-visible",
  "cluster-not-pixel-connected",
  "ash-industrial-raster-witness-missing",
  "production-human-witness-missing",
]);

function emptyRegionalMetrics() {
  return { landmark: [], wallpaper: null, yards: [], yardLifecycle: null, overlays: [], cluster: null, pixelScatter: null, ash: null };
}

async function validateRegionalR5VisualSetUnchecked(input) {
  const metrics = emptyRegionalMetrics();
  const errors = [];
  const fail = (name, detail) => errors.push(`${name}: ${detail}`);
  if (!input || typeof input !== "object") {
    for (const name of R5_STABLE_DIAGNOSTIC_NAMES) fail(name, "malformed aggregate input");
    return { errors, metrics };
  }
  const { kit, terrain, terrainSourcePngBytes, scenery, landmarks, yards, composed, keySceneContract } = input;
  if (!Object.hasOwn(R5_PURE_GROUND_TILE_CONTRACTS, kit)) {
    for (const name of R5_STABLE_DIAGNOSTIC_NAMES) fail(name, "unknown or missing regional kit");
    return { errors, metrics };
  }
  try {
    assertImage(terrain, "terrain");
    assertImage(landmarks, "landmarks");
    assertImage(yards, "yards");
    assertImage(composed, "composed");
  } catch (error) {
    for (const name of R5_STABLE_DIAGNOSTIC_NAMES) fail(name, error.message);
    return { errors, metrics };
  }
  try {
    if (terrain.width !== 256 || terrain.height !== 256) throw new Error("top-level terrain is not exact 256x256");
    const terrainTrusted = await reconstructTrustedRow(R5_TRUSTED_TERRAIN_SOURCE_CONTRACTS, kit, terrainSourcePngBytes);
    if (!terrainTrusted || terrainTrusted.layers.length !== 1 || terrainTrusted.layers[0].role !== "terrain-atlas"
        || !imageByteDifference(terrainTrusted.atlas, terrain).exact) {
      throw new Error("top-level terrain is not bound to a reviewed source row");
    }
  } catch {
    fail("terrain-rgb-periodicity", `${kit}/top-level-terrain-authority-mismatch`);
  }
  let topLevelSceneryValid = true;
  try {
    assertImage(scenery, "scenery");
    if (scenery.width !== 512 || scenery.height !== 256) throw new RangeError("scenery must be exact 512x256");
  } catch {
    topLevelSceneryValid = false;
    fail("cluster-not-pixel-connected", `${kit}/top-level-scenery-missing`);
    if (kit === "ash-waste") fail("ash-industrial-raster-witness-missing", `${kit}/top-level-scenery-missing`);
  }
  try {
    for (let cell = 0; cell < 8; cell += 1) {
      const image = copyCell(landmarks, cell, 4, 128, 128);
      metrics.landmark.push(analyzeLandmarkMaterialDepth(image));
      if (validateLandmarkMaterialDepth(image).length > 0) fail("landmark-flat-material", `${kit}/cell-${cell}`);
    }
  } catch (error) {
    fail("landmark-flat-material", error.message);
  }
  try {
    metrics.wallpaper = analyzeComposedPixelAutocorrelation(composed, { kit });
    const terrainErrors = validateComposedPixelAutocorrelation(composed, { kit });
    if (terrainErrors.some((error) => error.startsWith("terrain-rgb-periodicity"))) fail("terrain-rgb-periodicity", kit);
    if (terrainErrors.some((error) => error.startsWith("terrain-phase-locked-motif") || error.startsWith("terrain-accent-speckle"))) fail("terrain-phase-locked-motif", kit);
  } catch (error) {
    fail("terrain-rgb-periodicity", error.message);
    fail("terrain-phase-locked-motif", error.message);
  }
  try {
    const yardCells = [0, 1, 2, 3, 4].map((cell) => copyCell(yards, cell, 5, 192, 160));
    metrics.yards = yardCells.map(analyzeYardCell);
    const lifecycleInput = { baseA: yardCells[0], baseB: yardCells[1], ruin: yardCells[4] };
    metrics.yardLifecycle = analyzeYardLifecycle(lifecycleInput);
    if ([0, 1, 4].some((cell) => metrics.yards[cell].threeSidedWrap)
        || validateYardLifecycle(lifecycleInput).length > 0) fail("yard-three-sided-wrap", kit);
    metrics.overlays = [2, 3].map((cell) => analyzeOverlayVisibility(yardCells[cell]));
    if ([2, 3].some((cell) => validateOverlayVisibility(yardCells[cell]).length > 0)) fail("yard-overlay-not-visible", `${kit}/raw-overlay`);
  } catch (error) {
    fail("yard-three-sided-wrap", error.message);
    fail("yard-overlay-not-visible", error.message);
  }
  if (!keySceneContract?.lifecycleOverlays) fail("yard-overlay-not-visible", `${kit}/coupled-composites-missing`);
  else {
    try {
      if ((await validateLifecycleOverlayComposites({
        ...keySceneContract.lifecycleOverlays,
        kit,
        yards,
        terrainSourcePngBytes,
        topLevelTerrain: terrain,
        composedScene: composed,
      })).length > 0) fail("yard-overlay-not-visible", `${kit}/coupled-composites-invalid`);
    } catch (error) {
      fail("yard-overlay-not-visible", error.message);
    }
  }
  try {
    metrics.pixelScatter = analyzePixelScatter(composed);
    if (metrics.pixelScatter.pickupComponents > 20 && metrics.pixelScatter.pickupComponentShare > 0.75) {
      fail("cluster-not-pixel-connected", `${kit}/actual-composed-pickup-scatter`);
    }
  } catch {
    metrics.pixelScatter = null;
  }
  if (!keySceneContract?.clusterWitness) fail("cluster-not-pixel-connected", `${kit}/scenery-evidence-missing`);
  else {
    try {
      const witness = keySceneContract.clusterWitness;
      if (!witness.scene || !imageByteDifference(witness.scene, composed).exact || witness.scene.width !== 768 || witness.scene.height !== 512) {
        fail("cluster-not-pixel-connected", `${kit}/cluster-sidecar-composed-mismatch`);
      } else if (!topLevelSceneryValid || (await validateConstructedCluster({
        kit,
        sourcePngBytes: witness.sourcePngBytes,
        scenery,
        baseLayer: witness.baseLayer,
        scene: composed,
      })).length > 0) fail("cluster-not-pixel-connected", kit);
    } catch (error) {
      fail("cluster-not-pixel-connected", error.message);
    }
  }
  if (kit === "ash-waste") {
    if (!keySceneContract?.ashIndustrialWitnesses) fail("ash-industrial-raster-witness-missing", "trusted ash evidence missing");
    else {
      try {
        const witness = keySceneContract.ashIndustrialWitnesses;
        if (!witness.scene || !imageByteDifference(witness.scene, composed).exact || witness.scene.width !== 768 || witness.scene.height !== 512) {
          fail("ash-industrial-raster-witness-missing", `${kit}/ash-sidecar-composed-mismatch`);
        } else if (!topLevelSceneryValid || (await validateAshIndustrialWitnesses({
          kit,
          sourcePngBytes: witness.sourcePngBytes,
          scenery,
          baseLayer: witness.baseLayer,
          scene: composed,
        })).length > 0) fail("ash-industrial-raster-witness-missing", kit);
      } catch (error) {
        fail("ash-industrial-raster-witness-missing", error.message);
      }
    }
  }
  if (!keySceneContract?.humanEvidence) fail("production-human-witness-missing", `${kit}/human-evidence-missing`);
  else {
    try {
      const evidence = keySceneContract.humanEvidence;
      if (evidence.scene && (!imageByteDifference(evidence.scene, composed).exact || evidence.scene.width !== 768 || evidence.scene.height !== 512)) {
        fail("production-human-witness-missing", `${kit}/human-sidecar-composed-mismatch`);
      } else if ((await validateProductionHumanWitnesses({
        kit,
        sourcePngBytes: evidence.sourcePngBytes,
        human: evidence.human,
        scene: composed,
      })).length > 0) fail("production-human-witness-missing", kit);
    } catch (error) {
      fail("production-human-witness-missing", error.message);
    }
  }
  return { errors: [...new Set(errors)], metrics };
}

export async function validateRegionalR5VisualSet(input) {
  try {
    return await validateRegionalR5VisualSetUnchecked(input);
  } catch {
    return {
      errors: R5_STABLE_DIAGNOSTIC_NAMES.map((name) => `${name}: malformed aggregate input`),
      metrics: emptyRegionalMetrics(),
    };
  }
}
