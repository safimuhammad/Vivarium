/** Pure R5 dynamic presentation composition over atlas-only static scenes. */

import { createHash } from "node:crypto";

import sharp from "sharp";

const WIDTH = 768;
const HEIGHT = 512;
const CHANNELS = 4;
const KITS = Object.freeze([
  "ash-waste",
  "dry-scrub",
  "neutral-temperate",
  "spring-terraces",
  "worn-heartland",
]);
const PAINTER_ORDER = Object.freeze([
  "static-atlas-only",
  "yard",
  "home-actor-back",
  "human-contact-shadows",
  "humans-feet-sorted",
  "home-actor-front",
]);
const HUMAN_FEET = Object.freeze({ x: 24, y: 61 });
const HUMAN_PATCH_SHA256 = "4bcdc9f7fc15ab203eb96e99cb1108c3b884e198be284c6b958170f9f5f67e0e";
const FACE_PATCH_SHA256 = "a239bfa4bc54bc70e9f13284e9ee4ee3f9f7ae0c2e1c32b27b7f1c94ccb3b085";
const HAIR_PATCH_SHA256 = "fb1033cc2fdfcc88e9395194022381029a7080bca5574264ce73a39063b91fbb";
const SHADOW = Object.freeze({
  width: 24,
  height: 5,
  opaquePixels: 80,
  rows: Object.freeze([
    "000000111111111111000000",
    "000011111111111111110000",
    "111111111111111111111111",
    "000011111111111111110000",
    "000000111111111111000000",
  ]),
  anchor: Object.freeze({ x: 12, y: 2 }),
  color: Object.freeze([31, 29, 38, 255]),
});
const ENTRANCE = Object.freeze({
  portal: Object.freeze({ x: 48, y: 36, width: 32, height: 60 }),
  threshold: Object.freeze({ x: 43, y: 95, width: 39, height: 19 }),
  foregroundBand: Object.freeze({ x: 43, y: 95, width: 32, height: 1 }),
  apron: Object.freeze({ x: 80, y: 63, width: 48, height: 64 }),
});
const HOME_CONSTRUCTION = Object.freeze({
  origin: Object.freeze({ x: 32, y: 16 }),
  proofWidth: 192,
  proofHeight: 160,
  frames: Object.freeze([
    Object.freeze({ cell: 0, group: "back" }),
    Object.freeze({ cell: 1, group: "back" }),
    Object.freeze({ cell: 2, group: "back" }),
    Object.freeze({ cell: 16, group: "back" }),
    Object.freeze({ cell: 19, group: "back" }),
    Object.freeze({ cell: 22, group: "back" }),
    Object.freeze({ cell: 6, group: "front" }),
    Object.freeze({ cell: 9, group: "front" }),
  ]),
});
const SOURCE_CONTRACTS = Object.freeze({
  "ash-waste-home-components": Object.freeze({
    pngSha256: "0287d57855cae898155247f9cf2dad0fa323290a3dbe4d99ef3b134994c5e92f",
    width: 768, height: 512, cellWidth: 128, cellHeight: 128,
  }),
  "ash-waste-home-yards": Object.freeze({
    pngSha256: "434ac4f67869661e3b2b93afc92c4181fb515a2dc23657425579a63a09cb9102",
    width: 960, height: 160, cellWidth: 192, cellHeight: 160,
  }),
  "dry-scrub-home-components": Object.freeze({
    pngSha256: "17073e2d69cf1e8cc6b1252178881aa68c0865fb80a8fe7c66cdd492ff40c57e",
    width: 768, height: 512, cellWidth: 128, cellHeight: 128,
  }),
  "dry-scrub-home-yards": Object.freeze({
    pngSha256: "5663ea6f8292fb4d17ddc556246570d2ab18f6ad41b0e5381f59bcc5432ab460",
    width: 960, height: 160, cellWidth: 192, cellHeight: 160,
  }),
  "neutral-temperate-home-components": Object.freeze({
    pngSha256: "f1f834a02ffeef895addeab4c37baada636cf9a95dcd29235ba2c67a5e85cf4f",
    width: 768, height: 512, cellWidth: 128, cellHeight: 128,
  }),
  "neutral-temperate-home-yards": Object.freeze({
    pngSha256: "13e17622f3375d1242c8d9881ccd4205f78ec6df55464f0df615ae3a4f8242c2",
    width: 960, height: 160, cellWidth: 192, cellHeight: 160,
  }),
  "spring-terraces-home-components": Object.freeze({
    pngSha256: "4f827b042cb4fa7164fe43bc9fedbc518ca2a3fd6799914fe78746ee32a2a14c",
    width: 768, height: 512, cellWidth: 128, cellHeight: 128,
  }),
  "spring-terraces-home-yards": Object.freeze({
    pngSha256: "587c46cd7bfe54fcb96ca0e36dd34732d63b15b74c8c14b3ee260b720281451e",
    width: 960, height: 160, cellWidth: 192, cellHeight: 160,
  }),
  "worn-heartland-home-components": Object.freeze({
    pngSha256: "7ce0385755bdccf76d92324bdec1d1017d26a94c3dd68d8532ea16ecb1e3ab4b",
    width: 768, height: 512, cellWidth: 128, cellHeight: 128,
  }),
  "worn-heartland-home-yards": Object.freeze({
    pngSha256: "bdadc63113ecd94e517cf12c3b279a9f581a09b7ca84a057ef4ac0259af09dae",
    width: 960, height: 160, cellWidth: 192, cellHeight: 160,
  }),
  "core-human-body-rigs": Object.freeze({
    pngSha256: "edb6d5dfadaf9714d00b392da7ee89931d145cc6226184abf7835d23f4a67716",
    width: 768, height: 1408, cellWidth: 48, cellHeight: 64, cell: 1,
  }),
  "core-human-face-planes": Object.freeze({
    pngSha256: "4673092a327f228bbae97b1fdaa460d2d39a3470bdbc65920e32e8ef14c4cc6e",
    width: 768, height: 256, cellWidth: 48, cellHeight: 64, cell: 0,
  }),
  "core-human-hair": Object.freeze({
    pngSha256: "add7fea3720162c7cfbafb215d92b5d41031cf9843b47df5f26eafdc2877861c",
    width: 768, height: 768, cellWidth: 48, cellHeight: 64, cell: 0,
  }),
  "core-human-clothing-00": Object.freeze({
    pngSha256: "da3743c71a78e78fe458a409fade7f25eb2c099ab6bba7764e6fc9a6734aa0f2",
    width: 768, height: 704, cellWidth: 48, cellHeight: 64, cell: 1,
  }),
});
const SOURCE_NAMES = Object.freeze(Object.keys(SOURCE_CONTRACTS).sort(compareText));

const human = (kit, index, role, x, y) => ({
  id: `r5-dynamic/${kit}/human/${index}`,
  role,
  destination: { x, y, width: 48, height: 64 },
});

const placedScene = (kit, yardX, yardY, homeX, homeY, humans) => ({
  yard: {
    id: `r5-dynamic/${kit}/yard`,
    atlasId: `${kit}-home-yards`,
    cell: 0,
    destination: { x: yardX, y: yardY, width: 192, height: 160 },
  },
  homeActor: {
    id: `r5-dynamic/${kit}/home-actor`,
    componentAtlasId: `${kit}-home-components`,
    destination: { x: homeX, y: homeY, width: 128, height: 128 },
  },
  humans,
});

const PLACEMENT_BODY = Object.freeze({
  schema: "regional-r5-dynamic-presentation-placements/v1",
  scenes: Object.freeze({
    "ash-waste": placedScene("ash-waste", 528, 288, 560, 304, [
      human("ash-waste", 0, "route-entry", 120, 435),
      human("ash-waste", 1, "defining-landmark", 328, 195),
      human("ash-waste", 2, "shelter-door", 640, 367),
    ]),
    "dry-scrub": placedScene("dry-scrub", 560, 256, 592, 272, [
      human("dry-scrub", 0, "route-entry", 696, 51),
      human("dry-scrub", 1, "defining-landmark", 552, 99),
      human("dry-scrub", 2, "shelter-door", 672, 310),
    ]),
    "neutral-temperate": placedScene("neutral-temperate", 464, 320, 496, 336, [
      human("neutral-temperate", 0, "route-entry", 248, 19),
      human("neutral-temperate", 1, "defining-landmark", 168, 195),
      human("neutral-temperate", 2, "shelter-door", 576, 399),
    ]),
    "spring-terraces": placedScene("spring-terraces", 496, 288, 528, 304, [
      human("spring-terraces", 0, "route-entry", 24, 211),
      human("spring-terraces", 1, "defining-landmark", 72, 227),
      human("spring-terraces", 2, "shelter-door", 608, 367),
    ]),
    "worn-heartland": placedScene("worn-heartland", 528, 320, 560, 336, [
      human("worn-heartland", 0, "route-entry", 24, 83),
      human("worn-heartland", 1, "defining-landmark", 72, 99),
      human("worn-heartland", 2, "shelter-door", 640, 399),
    ]),
  }),
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
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

const STATIC_SCENE_CONTRACTS = Object.freeze({
  "b52272dfdcd3e81b5523d9005763ab7b08601f4fb2aa3326cac7d75a7198cc7c:056188f88c281e0832eb09ad727281c69a1f83a1ddc73555802c735302b455eb": Object.freeze({
    "ash-waste": Object.freeze(["307ba0ba3cbc8267dc783586e02716cb5dbe317217378cd1b75b703e05111ca6", "d0ab02fc40131e928fc79a07b7147cab4c9e723c736cc8f88fa0fe457c91f131"]),
    "dry-scrub": Object.freeze(["9d054edfe3d414a0c563edf68d852b934a5638998d437703abe5e6dbd12a35f4", "805e588ad011e00170e30953c3dc16275c67a0930c05acbb35dfe8e66171bd15"]),
    "neutral-temperate": Object.freeze(["4e0fc209053f5885af889bcd97a49614fa9b54159cff3308fef5478b106004f6", "b3af8c6d6d2ab0e386250540a47ae7826e56f8b4430dbbdc133fae37bd19a055"]),
    "spring-terraces": Object.freeze(["0b14cf4555b7c68a0c773ccc90e4c57d4ba8f001405ea9bc2d04d1057d1faffb", "855874c7155ded080b7b05798125695f47c07e9f8f416530628a0c7064e7b309"]),
    "worn-heartland": Object.freeze(["013bb404bbe79bf3c48f9256330dc6ef13a2e56dd46c6d5598d4177bbf5de943", "6483469e88081c7caaa9e75f058a7829acfd768ad113bf752e2fc00ea9185655"]),
  }),
  "b1c4d38aab25062b353e4a1fc78c4c509c8602b88bdcf443bda6b68656dbfb89:b5efe97bce2b8c4f4f153e5fff08717194958dd0e1da1c66477af12867548e7a": Object.freeze({
    "ash-waste": Object.freeze(["bf14dbcbc01a10ccfdab23edd9ea375d402525b6dbe1b2be8de85c835ca8e931", "379e7837d436600ea107540a72d262ecfe5af8c34fd513a0c1abae4b8e14e9a8"]),
    "dry-scrub": Object.freeze(["407de9b74feea4be51ac693a44f3112dda517dfc5b9fb6e300ebf510afc9dce6", "f966f9cafe4f837817c266b8994c296d59cbc7872516f88968a50f04dec10410"]),
    "neutral-temperate": Object.freeze(["7b612328402c0373564fcb0a8f558dc2a5ba159f3fdbc5b8208a1bccf468cb80", "efe675d447a163fa52ed693d9613e9def9ebac5d4b2e39756e6c7abda38990a8"]),
    "spring-terraces": Object.freeze(["40deb5eb01e2e1ba22128ecabd1af33d6bf427476f2452f217534fa6905df9a0", "0517b937794d143f66f9918b91b7c54aafc4aba6d2d2ecc124823433fb4c756e"]),
    "worn-heartland": Object.freeze(["f5b63461f4452673b02caabaedf8f2d25cbcb389641066fbb9a0b1f87f40737b", "5fa69fd92968866d3b6c57e4a1ad3eed6b48c48fd86cd609bee191b27098dade"]),
  }),
});
const V3_STATIC_CONTRACT_KEY = "b1c4d38aab25062b353e4a1fc78c4c509c8602b88bdcf443bda6b68656dbfb89:b5efe97bce2b8c4f4f153e5fff08717194958dd0e1da1c66477af12867548e7a";
const V3_STATIC_TRUST = Object.freeze({
  schema: "regional-r5-v3-static-trust/v1",
  masterSetSha256: "b1c4d38aab25062b353e4a1fc78c4c509c8602b88bdcf443bda6b68656dbfb89",
  placementSha256: "b5efe97bce2b8c4f4f153e5fff08717194958dd0e1da1c66477af12867548e7a",
  authoringIdentitySha256: "89a6d80c477c615cdb738c7a239340973f490e29a959ab3bf0d8574389518cad",
  landmarkPortReceiptSha256: "c37c435218ba17e3023102228ef43bd6c00def9d9d2dab78946b1bc9bef18ea9",
  integrationIdentitySha256: "add5742d9567069b108fe67c3154ecdb61c8ca0f7616533913641ff4d29253e0",
  compositorIdentitySha256: "0147ce8e912149542b0a9f9d562521dc40946520d8358e77b4d7933fa2edc78a",
  visibleStaticReceiptSha256: "170dc3a7337ad7cf05ddf19d1fb107499113f3c2e4379b4cced05dd65cb8f603",
  sceneRgbaSha256: Object.freeze({
    "ash-waste": "bf14dbcbc01a10ccfdab23edd9ea375d402525b6dbe1b2be8de85c835ca8e931",
    "dry-scrub": "407de9b74feea4be51ac693a44f3112dda517dfc5b9fb6e300ebf510afc9dce6",
    "neutral-temperate": "7b612328402c0373564fcb0a8f558dc2a5ba159f3fdbc5b8208a1bccf468cb80",
    "spring-terraces": "40deb5eb01e2e1ba22128ecabd1af33d6bf427476f2452f217534fa6905df9a0",
    "worn-heartland": "f5b63461f4452673b02caabaedf8f2d25cbcb389641066fbb9a0b1f87f40737b",
  }),
  canonicalSha256: "582bf14b4581b252f0f7cdeb533fadf01fa999e9f3490053cce069b25013728d",
});

const PLACEMENT_SHA256 = sha256(Buffer.from(canonicalJson(PLACEMENT_BODY)));
const AUTHORITY = Object.freeze({ ...PLACEMENT_BODY, canonicalSha256: PLACEMENT_SHA256 });

/** Typed failure at the dynamic-presentation input boundary. */
export class RegionalR5DynamicPresentationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RegionalR5DynamicPresentationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new RegionalR5DynamicPresentationError(code, message);
}

function assertClosedInput(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail("CALLER_SOURCE_FORBIDDEN", "A-prime dynamic input must be a plain object.");
  }
  const keys = Object.keys(input).sort(compareText);
  const expected = ["dynamicSourceBuffers", "placements", "staticScenes"].sort(compareText);
  if (canonicalJson(keys) !== canonicalJson(expected)) {
    fail("CALLER_SOURCE_FORBIDDEN", "A-prime dynamic input accepts only staticScenes, dynamicSourceBuffers, and placements.");
  }
}

function assertPlacements(placements, v4Trust) {
  let accepted = canonicalJson(placements) === canonicalJson(AUTHORITY);
  if (!accepted) {
    try {
      accepted = canonicalJson(placements) === canonicalJson(v4Trust?.dynamicPlacements);
    } catch {
      accepted = false;
    }
  }
  if (!accepted) {
    fail("PLACEMENT_AUTHORITY_INVALID", "A-prime dynamic placement authority is missing, extra, or altered.");
  }
}

function assertRaw(raw, label) {
  if (!raw || !Buffer.isBuffer(raw.data)
      || raw.width !== WIDTH || raw.height !== HEIGHT || raw.channels !== CHANNELS
      || raw.data.length !== WIDTH * HEIGHT * CHANNELS) {
    fail("STATIC_SCENE_INVALID", `${label}: exact 768x512 RGBA pixels are required.`);
  }
}

function assertStaticScenes(staticScenes, v4Trust) {
  if (staticScenes?.schema !== "regional-r5-atlas-only-scenes/v1"
      || staticScenes?.atlasOnly !== true || staticScenes?.published !== false
      || canonicalJson(Object.keys(staticScenes?.scenes ?? {}).sort(compareText)) !== canonicalJson(KITS)) {
    fail("STATIC_SCENE_INVALID", "A-prime dynamic composition requires all five atlas-only static scenes.");
  }
  if (staticScenes.generation === "v4") {
    const trust = v4Trust;
    const expected = staticScenes.trustedV4;
    const trustBody = expected && Object.fromEntries(Object.entries(expected)
      .filter(([key]) => key !== "canonicalSha256"));
    if (!expected || expected.integrationIdentitySha256 !== trust.integrationIdentity.canonicalSha256
        || expected.receiptSha256 !== trust.receipt.canonicalSha256
        || expected.masterSetSha256 !== trust.authoringIdentity.masterSetSha256
        || expected.placementSha256 !== trust.placementSha256
        || expected.canonicalSha256 !== canonicalDigest(trustBody)) {
      fail("V4_STATIC_TRUST_MISMATCH", "V4 static trust receipt does not match its scene-first builder output.");
    }
    for (const kit of KITS) {
      const scene = staticScenes.scenes[kit];
      assertRaw(scene?.raw, kit);
      if (scene.kit !== kit || scene.rgbaSha256 !== sha256(scene.raw.data)
          || scene.rgbaSha256 !== expected.sceneRgbaSha256[kit]
          || !Array.isArray(scene.visibleStaticLayers) || scene.visibleStaticLayers.length !== 408) {
        fail("V4_STATIC_TRUST_MISMATCH", `${kit}: exact V4 408-layer static receipt is required.`);
      }
    }
    return {
      generation: "v4",
      integrationIdentitySha256: trust.integrationIdentity.canonicalSha256,
    };
  }
  const contractKey = `${staticScenes.masterSetSha256}:${staticScenes.placementSha256}`;
  const contract = STATIC_SCENE_CONTRACTS[contractKey];
  if (!contract) {
    fail("STATIC_SCENE_INVALID", "A-prime dynamic composition requires a trusted atlas-only master and placement identity.");
  }
  const generation = contractKey === V3_STATIC_CONTRACT_KEY ? "v3" : "v2";
  const trustFailure = (message) => fail(
    generation === "v3" ? "V3_STATIC_TRUST_MISMATCH" : "STATIC_SCENE_INVALID",
    message,
  );
  if (generation === "v3"
      && (staticScenes.generation !== "v3"
        || staticScenes.integrationIdentitySha256 !== V3_STATIC_TRUST.integrationIdentitySha256
        || staticScenes.compositorIdentitySha256 !== V3_STATIC_TRUST.compositorIdentitySha256
        || staticScenes.visibleStaticReceiptSha256 !== V3_STATIC_TRUST.visibleStaticReceiptSha256
        || staticScenes.authoringIdentitySha256 !== V3_STATIC_TRUST.authoringIdentitySha256
        || canonicalJson(staticScenes.trustedV3) !== canonicalJson(V3_STATIC_TRUST))) {
    trustFailure("V3 static trust receipt does not match the independently pinned compositor output.");
  }
  for (const kit of KITS) {
    const scene = staticScenes.scenes[kit];
    assertRaw(scene?.raw, kit);
    if (scene.kit !== kit || scene.rgbaSha256 !== sha256(scene.raw.data)
        || !Array.isArray(scene.visibleStaticLayers) || scene.visibleStaticLayers.length !== 408) {
      trustFailure(`${kit}: exact 408-layer static receipt is required.`);
    }
    if (scene.rgbaSha256 !== contract[kit][0]
        || sha256(Buffer.from(canonicalJson(scene.visibleStaticLayers))) !== contract[kit][1]) {
      trustFailure(`${kit}: atlas-only pixels or layer provenance do not match trusted builder output.`);
    }
    for (const layer of scene.visibleStaticLayers) {
      const atlasId = layer?.provenance?.atlasId;
      if (typeof atlasId !== "string"
          || (!atlasId.endsWith("-terrain")
            && !atlasId.endsWith("-scenery")
            && !atlasId.endsWith("-landmarks"))) {
        trustFailure(`${kit}: dynamic material appeared in the static receipt.`);
      }
    }
  }
  return {
    generation,
    integrationIdentitySha256: generation === "v3"
      ? V3_STATIC_TRUST.integrationIdentitySha256 : undefined,
  };
}

function assertSourceInventory(dynamicSourceBuffers) {
  if (dynamicSourceBuffers === null || typeof dynamicSourceBuffers !== "object"
      || Array.isArray(dynamicSourceBuffers)
      || canonicalJson(Object.keys(dynamicSourceBuffers).sort(compareText)) !== canonicalJson(SOURCE_NAMES)) {
    fail("DYNAMIC_SOURCE_INVENTORY_INVALID", "A-prime dynamic sources require the exact fourteen-buffer inventory.");
  }
  for (const name of SOURCE_NAMES) {
    const bytes = dynamicSourceBuffers[name];
    if (!Buffer.isBuffer(bytes)) {
      fail("DYNAMIC_SOURCE_INVENTORY_INVALID", `${name}: encoded source must be Buffer bytes.`);
    }
    const actual = sha256(bytes);
    if (actual !== SOURCE_CONTRACTS[name].pngSha256) {
      fail("DYNAMIC_SOURCE_HASH_MISMATCH", `${name}: encoded source hash drift ${actual}.`);
    }
  }
}

async function decodeSources(dynamicSourceBuffers) {
  const decoded = {};
  for (const name of SOURCE_NAMES) {
    const contract = SOURCE_CONTRACTS[name];
    let result;
    try {
      result = await sharp(dynamicSourceBuffers[name]).ensureAlpha().raw()
        .toBuffer({ resolveWithObject: true });
    } catch (error) {
      fail("DYNAMIC_SOURCE_DECODE_FAILED", `${name}: PNG decode failed (${error.message}).`);
    }
    const { data, info } = result;
    if (info.width !== contract.width || info.height !== contract.height || info.channels !== CHANNELS) {
      fail("DYNAMIC_SOURCE_GEOMETRY_INVALID", `${name}: decoded source geometry drift.`);
    }
    decoded[name] = { data, width: info.width, height: info.height, channels: CHANNELS, contract };
  }
  return decoded;
}

function sourceCell(source, cell, label) {
  const { cellWidth, cellHeight } = source.contract;
  const columns = source.width / cellWidth;
  const rows = source.height / cellHeight;
  if (!Number.isSafeInteger(cell) || cell < 0 || cell >= columns * rows) {
    fail("DYNAMIC_SOURCE_CELL_INVALID", `${label}: source cell is out of range.`);
  }
  const x = cell % columns * cellWidth;
  const y = Math.floor(cell / columns) * cellHeight;
  const data = Buffer.alloc(cellWidth * cellHeight * CHANNELS);
  for (let row = 0; row < cellHeight; row += 1) {
    const start = ((y + row) * source.width + x) * CHANNELS;
    source.data.copy(data, row * cellWidth * CHANNELS, start, start + cellWidth * CHANNELS);
  }
  return {
    raw: { data, width: cellWidth, height: cellHeight, channels: CHANNELS },
    sourceRect: { x, y, width: cellWidth, height: cellHeight },
  };
}

function placeOpaque(destination, source, x, y) {
  for (let sourceY = 0; sourceY < source.height; sourceY += 1) {
    for (let sourceX = 0; sourceX < source.width; sourceX += 1) {
      const sourceOffset = (sourceY * source.width + sourceX) * CHANNELS;
      const alpha = source.data[sourceOffset + 3];
      if (alpha !== 0 && alpha !== 255) {
        fail("DYNAMIC_SOURCE_ALPHA_INVALID", "A-prime dynamic sources require binary alpha.");
      }
      if (alpha === 0) continue;
      const destinationX = x + sourceX;
      const destinationY = y + sourceY;
      if (destinationX < 0 || destinationY < 0
          || destinationX >= destination.width || destinationY >= destination.height) continue;
      source.data.copy(destination.data,
        (destinationY * destination.width + destinationX) * CHANNELS,
        sourceOffset,
        sourceOffset + CHANNELS);
    }
  }
}

function cropRaw(source, x, y, width, height) {
  const data = Buffer.alloc(width * height * CHANNELS);
  for (let row = 0; row < height; row += 1) {
    const start = ((y + row) * source.width + x) * CHANNELS;
    source.data.copy(data, row * width * CHANNELS, start, start + width * CHANNELS);
  }
  return { data, width, height, channels: CHANNELS };
}

function buildHome(decoded, kit) {
  const sourceName = `${kit}-home-components`;
  const source = decoded[sourceName];
  const groups = {};
  const receipts = {};
  for (const group of ["back", "front"]) {
    const proof = {
      data: Buffer.alloc(HOME_CONSTRUCTION.proofWidth * HOME_CONSTRUCTION.proofHeight * CHANNELS),
      width: HOME_CONSTRUCTION.proofWidth,
      height: HOME_CONSTRUCTION.proofHeight,
      channels: CHANNELS,
    };
    receipts[group] = [];
    for (const frame of HOME_CONSTRUCTION.frames.filter((candidate) => candidate.group === group)) {
      const cell = sourceCell(source, frame.cell, sourceName);
      placeOpaque(proof, cell.raw, HOME_CONSTRUCTION.origin.x, HOME_CONSTRUCTION.origin.y);
      receipts[group].push({
        atlasId: sourceName,
        pngSha256: source.contract.pngSha256,
        cell: frame.cell,
        group,
        sourceRect: cell.sourceRect,
        sourceRgbaSha256: sha256(cell.raw.data),
      });
    }
    groups[group] = cropRaw(proof, HOME_CONSTRUCTION.origin.x, HOME_CONSTRUCTION.origin.y, 128, 128);
  }
  return { ...groups, receipts };
}

function buildHuman(decoded) {
  const names = [
    "core-human-body-rigs",
    "core-human-face-planes",
    "core-human-hair",
    "core-human-clothing-00",
  ];
  const raw = { data: Buffer.alloc(48 * 64 * CHANNELS), width: 48, height: 64, channels: CHANNELS };
  const receipts = [];
  const semanticDigests = {};
  for (const name of names) {
    const source = decoded[name];
    const cell = sourceCell(source, source.contract.cell, name);
    placeOpaque(raw, cell.raw, 0, 0);
    receipts.push({
      atlasId: name,
      pngSha256: source.contract.pngSha256,
      cell: source.contract.cell,
      sourceRect: cell.sourceRect,
      sourceRgbaSha256: sha256(cell.raw.data),
    });
    if (name === "core-human-face-planes") semanticDigests.face = sha256(cell.raw.data);
    if (name === "core-human-hair") semanticDigests.hair = sha256(cell.raw.data);
  }
  if (sha256(raw.data) !== HUMAN_PATCH_SHA256
      || semanticDigests.face !== FACE_PATCH_SHA256
      || semanticDigests.hair !== HAIR_PATCH_SHA256) {
    fail("DYNAMIC_COMPONENT_IDENTITY_MISMATCH", "Canonical human, face, or hair bytes drifted.");
  }
  return { raw, receipts };
}

function buildShadows(humans) {
  const raw = { data: Buffer.alloc(WIDTH * HEIGHT * CHANNELS), width: WIDTH, height: HEIGHT, channels: CHANNELS };
  const instances = [];
  for (const witness of humans) {
    const feet = {
      x: witness.destination.x + HUMAN_FEET.x,
      y: witness.destination.y + HUMAN_FEET.y,
    };
    const origin = { x: feet.x - SHADOW.anchor.x, y: feet.y - SHADOW.anchor.y };
    let opaquePixels = 0;
    for (let y = 0; y < SHADOW.height; y += 1) {
      for (let x = 0; x < SHADOW.width; x += 1) {
        if (SHADOW.rows[y][x] === "0") continue;
        const destinationX = origin.x + x;
        const destinationY = origin.y + y;
        if (destinationX < 0 || destinationY < 0
            || destinationX >= WIDTH || destinationY >= HEIGHT) {
          fail("DYNAMIC_PLACEMENT_OUT_OF_BOUNDS", `${witness.id}: contact shadow exceeds scene bounds.`);
        }
        raw.data.set(SHADOW.color, (destinationY * WIDTH + destinationX) * CHANNELS);
        opaquePixels += 1;
      }
    }
    if (opaquePixels !== SHADOW.opaquePixels) {
      fail("DYNAMIC_COMPONENT_IDENTITY_MISMATCH", `${witness.id}: contact shadow identity drifted.`);
    }
    instances.push({ humanId: witness.id, feet, origin, opaquePixels });
  }
  return { raw, instances };
}

const within = (x, y, rect) => x >= rect.x && x < rect.x + rect.width
  && y >= rect.y && y < rect.y + rect.height;

function maskFront(front, kit, scenePlacement) {
  const shelter = scenePlacement.humans.find(({ role }) => role === "shelter-door");
  const relativeShelter = {
    x: shelter.destination.x - scenePlacement.homeActor.destination.x,
    y: shelter.destination.y - scenePlacement.homeActor.destination.y,
    width: shelter.destination.width,
    height: shelter.destination.height,
  };
  const apron = kit === "dry-scrub" ? relativeShelter : ENTRANCE.apron;
  const raw = { data: Buffer.alloc(front.data.length), width: front.width, height: front.height, channels: CHANNELS };
  for (let y = 0; y < front.height; y += 1) {
    for (let x = 0; x < front.width; x += 1) {
      const offset = (y * front.width + x) * CHANNELS;
      if (front.data[offset + 3] === 0) continue;
      if ((within(x, y, ENTRANCE.portal) || within(x, y, apron))
          && !(within(x, y, ENTRANCE.threshold) && within(x, y, ENTRANCE.foregroundBand))) {
        continue;
      }
      front.data.copy(raw.data, offset, offset, offset + CHANNELS);
    }
  }
  return raw;
}

function assertNoHumanOverlap(humans, kit) {
  if (humans.length !== 3 || new Set(humans.map(({ id }) => id)).size !== 3) {
    fail("DYNAMIC_PLACEMENT_INVALID", `${kit}: exactly three unique humans are required.`);
  }
  for (let left = 0; left < humans.length; left += 1) {
    const a = humans[left].destination;
    for (let right = left + 1; right < humans.length; right += 1) {
      const b = humans[right].destination;
      if (a.x < b.x + b.width && b.x < a.x + a.width
          && a.y < b.y + b.height && b.y < a.y + a.height) {
        fail("DYNAMIC_HUMAN_OVERLAP", `${kit}: human bounds overlap.`);
      }
    }
  }
}

function composeScene(staticScene, decoded, placement, kit) {
  assertNoHumanOverlap(placement.humans, kit);
  const output = {
    data: Buffer.from(staticScene.raw.data),
    width: WIDTH,
    height: HEIGHT,
    channels: CHANNELS,
  };
  const yard = sourceCell(decoded[placement.yard.atlasId], placement.yard.cell, placement.yard.atlasId);
  const home = buildHome(decoded, kit);
  const human = buildHuman(decoded);
  const shadows = buildShadows(placement.humans);
  const front = maskFront(home.front, kit, placement);
  placeOpaque(output, yard.raw, placement.yard.destination.x, placement.yard.destination.y);
  placeOpaque(output, home.back, placement.homeActor.destination.x, placement.homeActor.destination.y);
  placeOpaque(output, shadows.raw, 0, 0);
  const sortedHumans = placement.humans.map((witness) => ({
    ...witness,
    feet: {
      x: witness.destination.x + HUMAN_FEET.x,
      y: witness.destination.y + HUMAN_FEET.y,
    },
  })).sort((left, right) => left.feet.y - right.feet.y
    || left.feet.x - right.feet.x || compareText(left.id, right.id));
  for (const witness of sortedHumans) {
    placeOpaque(output, human.raw, witness.destination.x, witness.destination.y);
  }
  placeOpaque(output, front, placement.homeActor.destination.x, placement.homeActor.destination.y);
  const shadowAuthority = {
    geometry: { width: SHADOW.width, height: SHADOW.height, opaquePixels: SHADOW.opaquePixels },
    rows: [...SHADOW.rows],
    anchor: { ...SHADOW.anchor },
    colorToken: "human-contact-shadow",
    colorRgba: [...SHADOW.color],
  };
  return {
    kit,
    raw: output,
    rgbaSha256: sha256(output.data),
    painterOrder: [...PAINTER_ORDER],
    static: {
      rgbaSha256: staticScene.rgbaSha256,
      visibleLayerCount: staticScene.visibleStaticLayers.length,
      visibleLayerIds: staticScene.visibleStaticLayers.map(({ id }) => id),
    },
    dynamic: {
      yard: {
        placement: structuredClone(placement.yard),
        patchRgbaSha256: sha256(yard.raw.data),
        provenance: {
          atlasId: placement.yard.atlasId,
          pngSha256: decoded[placement.yard.atlasId].contract.pngSha256,
          cell: placement.yard.cell,
          sourceRect: yard.sourceRect,
          sourceRgbaSha256: sha256(yard.raw.data),
        },
      },
      homeActor: {
        placement: structuredClone(placement.homeActor),
        backPatchRgbaSha256: sha256(home.back.data),
        frontPatchRgbaSha256: sha256(front.data),
        backSourceLayers: home.receipts.back,
        frontSourceLayers: home.receipts.front,
      },
      contactShadows: {
        rgbaSha256: sha256(shadows.raw.data),
        instances: shadows.instances,
        provenance: {
          sourceKind: "mechanics-authority",
          ...shadowAuthority,
          authoritySha256: sha256(Buffer.from(canonicalJson(shadowAuthority))),
        },
      },
      humans: sortedHumans.map((witness) => ({
        id: witness.id,
        placement: {
          id: witness.id,
          role: witness.role,
          destination: structuredClone(witness.destination),
          ...(witness.relocation ? { relocation: structuredClone(witness.relocation) } : {}),
        },
        feet: witness.feet,
        patchRgbaSha256: HUMAN_PATCH_SHA256,
        facePatchRgbaSha256: FACE_PATCH_SHA256,
        hairPatchRgbaSha256: HAIR_PATCH_SHA256,
        sourceLayers: structuredClone(human.receipts),
      })),
    },
  };
}

/** Return a detached copy of the reviewed dynamic placement authority. */
export function regionalR5DynamicPresentationPlacementsInternal() {
  return structuredClone(AUTHORITY);
}

/** Compose dynamic presentation layers without file access or publication. */
export async function buildRegionalR5DynamicPresentationScenesInternal(
  input,
  staticScenes,
  dynamicSourceBuffers,
  placements,
  v4Trust = null,
) {
  assertClosedInput(input);
  assertPlacements(placements, v4Trust);
  const staticIdentity = assertStaticScenes(staticScenes, v4Trust);
  assertSourceInventory(dynamicSourceBuffers);
  const decoded = await decodeSources(dynamicSourceBuffers);
  const scenes = {};
  for (const kit of KITS) {
    scenes[kit] = composeScene(staticScenes.scenes[kit], decoded, placements.scenes[kit], kit);
  }
  return {
    schema: "regional-r5-dynamic-presentation-scenes/v1",
    atlasOnlyStatic: true,
    published: false,
    staticGeneration: staticIdentity.generation,
    staticIntegrationIdentitySha256: staticIdentity.integrationIdentitySha256,
    placementSha256: placements.canonicalSha256,
    sourceNames: [...SOURCE_NAMES],
    ...(staticIdentity.generation === "v4" ? { task6Ready: false } : {}),
    scenes,
  };
}
