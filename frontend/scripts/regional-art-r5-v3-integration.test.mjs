/**
 * RED-only integration contract for the V3 atomic-source production handoff.
 *
 * This suite deliberately exercises the public packer seams. It does not
 * implement or substitute a compositor and it does not publish artifacts.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  REGIONAL_R5_A_PRIME_LITERAL_PLACEMENTS,
} from "./fixtures/regional-art-r5-atlas-only-literal-authority.mjs";
import {
  REGIONAL_R5_V3_ATOMIC_LITERAL_AUTHORITY,
} from "./fixtures/regional-art-r5-v3-atomic-literal-authority.mjs";
import * as productionPacker from "./pack-2d-production-assets.mjs";

const V3_INTEGRATION_API = "regionalR5V3IntegrationIdentity";
const API_READY = typeof productionPacker[V3_INTEGRATION_API] === "function";
const API_SKIP = API_READY
  ? false
  : `V3_INTEGRATION_RED/API_MISSING: ${V3_INTEGRATION_API}`;
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
const FORBIDDEN_AUTHORING_FIELDS = Object.freeze([
  "dynamicMask",
  "homeRect",
  "homeRects",
  "humanRect",
  "humanRects",
  "sceneMask",
]);
const REGION_GUIDE = new URL(
  "../../scratchpad/2d-production-art/source/imagegen-concepts/region-kits-imagegen-guide.png",
  import.meta.url,
);
const HOME_RUIN_GUIDE = new URL(
  "../../scratchpad/2d-production-art/source/imagegen-concepts/home-ruin-imagegen-guide.png",
  import.meta.url,
);
const NATIVE_SOURCE_ROOT = new URL(
  "../../scratchpad/2d-production-art/source/native/",
  import.meta.url,
);
const V3_SOURCE_MODULE = new URL("./regional-art-r5-v3-atomic-source.mjs", import.meta.url);

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

function cloneValue(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]));
  }
  return value;
}

function assertDeeplyFrozen(value, label) {
  assert.equal(Object.isFrozen(value), true, `${label}: must be frozen`);
  if (value === null || typeof value !== "object" || Buffer.isBuffer(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (child !== null && typeof child === "object") {
      assertDeeplyFrozen(child, `${label}.${key}`);
    }
  }
}

function terrainLayers(kit) {
  const rows = REGIONAL_R5_A_PRIME_LITERAL_PLACEMENTS[kit].terrainRows;
  return rows.flatMap((row, y) => Array.from({ length: 24 }, (_unused, x) => ({
    id: `r5-atlas-only/${kit}/terrain/${y}/${x}`,
    role: "terrain-foundation",
    atlasId: `${kit}-terrain`,
    cell: Number.parseInt(row.slice(x * 2, x * 2 + 2), 16),
    destination: { x: x * 32, y: y * 32 },
  })));
}

function landmarkLayers(kit) {
  return REGIONAL_R5_A_PRIME_LITERAL_PLACEMENTS[kit].landmarks
    .map(([cell, x, y, role], index) => ({
      id: `r5-atlas-only/${kit}/landmark/${index}`,
      role,
      atlasId: `${kit}-landmarks`,
      cell,
      destination: { x, y },
    }));
}

function supportLayers(kit) {
  return REGIONAL_R5_V3_ATOMIC_LITERAL_AUTHORITY.supportPlacements[kit]
    .map(([cell, x, y, role], index) => ({
      id: `r5-atlas-only/${kit}/support/${index}`,
      role,
      atlasId: `${kit}-scenery`,
      cell,
      destination: { x, y },
    }));
}

function expectedVisibleLayers(kit) {
  return [...terrainLayers(kit), ...landmarkLayers(kit), ...supportLayers(kit)];
}

function collectKeys(value, keys = []) {
  if (value === null || typeof value !== "object" || Buffer.isBuffer(value)) return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    collectKeys(child, keys);
  }
  return keys;
}

function expectCode(promise, code) {
  return assert.rejects(promise, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
}

let v3BuildPromise;
function v3Build() {
  v3BuildPromise ??= productionPacker.buildRegionalR5V3AtomicSourceMasters({
    authority: REGIONAL_R5_V3_ATOMIC_LITERAL_AUTHORITY,
  });
  return v3BuildPromise;
}

let v2BuildPromise;
function v2Build() {
  v2BuildPromise ??= (async () => productionPacker.buildRegionalR5SourceMasters({
    sourceBuffers: {
      regionKits: await readFile(REGION_GUIDE),
      homeRuin: await readFile(HOME_RUIN_GUIDE),
    },
  }))();
  return v2BuildPromise;
}

async function v3StaticScenes() {
  const v3 = await v3Build();
  return productionPacker.buildRegionalR5AtlasOnlyScenes({
    masterBuffers: v3.masterBuffers,
    placements: v3.placements,
    authoringIdentity: v3.authoringIdentity,
  });
}

async function dynamicSourceBuffers(masterBuffers) {
  const buffers = {};
  for (const kit of KITS) {
    buffers[`${kit}-home-yards`] = Buffer.from(masterBuffers[`${kit}-home-yards`]);
    buffers[`${kit}-home-components`] = await readFile(
      new URL(`homes/${kit}/components.png`, NATIVE_SOURCE_ROOT),
    );
  }
  for (const name of [
    "human-body-rigs",
    "human-face-planes",
    "human-hair",
    "human-clothing-00",
  ]) {
    buffers[`core-${name}`] = await readFile(new URL(`core/${name}.png`, NATIVE_SOURCE_ROOT));
  }
  return buffers;
}

test("V3 production integration identity is exposed", () => {
  assert.equal(
    typeof productionPacker[V3_INTEGRATION_API],
    "function",
    `V3_INTEGRATION_RED/API_MISSING: ${V3_INTEGRATION_API}`,
  );
});

test("V3 builder exposes a detached exact placement authority for all eighty support roles", {
  skip: API_SKIP,
}, async () => {
  const v3 = await v3Build();
  assert.equal(v3.placements.schema, "regional-r5-v3-atlas-only-placement-authority/v1");
  assert.equal(v3.placements.canonicalSha256, canonicalDigest({
    schema: v3.placements.schema,
    scenes: v3.placements.scenes,
  }));
  assert.notStrictEqual(v3.placements, productionPacker.regionalR5AtlasOnlyScenePlacements());
  assertDeeplyFrozen(v3.placements, "V3 placements");

  let supportCount = 0;
  for (const kit of KITS) {
    const scene = v3.placements.scenes[kit];
    assert.equal(scene.kit, kit);
    assert.deepEqual(scene.visibleStaticLayers, expectedVisibleLayers(kit),
      `${kit}: V3 must retain every exact coordinate and consume every remapped cell`);
    assert.equal(scene.visibleStaticLayers.length, 408);
    supportCount += scene.visibleStaticLayers.filter(({ id }) => id.includes("/support/")).length;
  }
  assert.equal(supportCount, 80);
});

test("real atlas-only compositor accepts exact V3 and keeps V2 explicitly diagnostic", {
  skip: API_SKIP,
}, async () => {
  const [v3, v2] = await Promise.all([v3Build(), v2Build()]);
  const identity = productionPacker[V3_INTEGRATION_API]();
  assert.deepEqual(Object.keys(identity).sort(compareText), [
    "canonicalSha256",
    "compositorIdentitySha256",
    "dynamicSchema",
    "generation",
    "placementSchema",
    "sourceSchema",
    "staticSchema",
    "v2Status",
  ]);
  assert.equal(identity.generation, "v3");
  assert.equal(identity.v2Status, "unpublished-diagnostic-only");
  assert.equal(identity.canonicalSha256, canonicalDigest(Object.fromEntries(
    Object.entries(identity).filter(([key]) => key !== "canonicalSha256"),
  )));

  const accepted = await productionPacker.buildRegionalR5AtlasOnlyScenes({
    masterBuffers: v3.masterBuffers,
    placements: v3.placements,
    authoringIdentity: v3.authoringIdentity,
  });
  assert.equal(accepted.generation, "v3");
  assert.equal(accepted.published, false);
  assert.equal(accepted.integrationIdentitySha256, identity.canonicalSha256);

  const diagnostic = await productionPacker.buildRegionalR5AtlasOnlyScenes({
    masterBuffers: v2.buffers,
    placements: productionPacker.regionalR5AtlasOnlyScenePlacements(),
  });
  assert.equal(diagnostic.generation, "v2");
  assert.equal(diagnostic.diagnosticOnly, true);
  assert.equal(diagnostic.task6Ready, false);
  assert.equal(diagnostic.published, false);
});

test("atlas-only compositor rejects every distinguishable 19-V3 plus 1-V2 mix and V2 placement", {
  skip: API_SKIP,
}, async () => {
  const [v3, v2] = await Promise.all([v3Build(), v2Build()]);
  let distinguishableMixes = 0;
  for (const name of MASTER_NAMES) {
    const v2Bytes = v2.buffers[name];
    const v3Bytes = v3.masterBuffers[name];
    if (sha256(v2Bytes) === sha256(v3Bytes)) {
      assert.deepEqual(v2Bytes, v3Bytes,
        `${name}: byte-identical unchanged masters have no distinguishable generation`);
      continue;
    }
    distinguishableMixes += 1;
    const mixed = Object.fromEntries(MASTER_NAMES.map((candidate) => [
      candidate,
      Buffer.from(candidate === name ? v2Bytes : v3.masterBuffers[candidate]),
    ]));
    await expectCode(productionPacker.buildRegionalR5AtlasOnlyScenes({
      masterBuffers: mixed,
      placements: v3.placements,
      authoringIdentity: v3.authoringIdentity,
    }), "V3_MASTER_SET_IDENTITY_MISMATCH");
  }
  assert.equal(distinguishableMixes, 10,
    "V3 must replace exactly the ten scenery/landmark masters");

  await expectCode(productionPacker.buildRegionalR5AtlasOnlyScenes({
    masterBuffers: v3.masterBuffers,
    placements: productionPacker.regionalR5AtlasOnlyScenePlacements(),
    authoringIdentity: v3.authoringIdentity,
  }), "V3_PLACEMENT_IDENTITY_MISMATCH");
});

test("V3 static result binds the exact master set, placement, compositor, and layer receipt", {
  skip: API_SKIP,
}, async () => {
  const [v3, scenes] = await Promise.all([v3Build(), v3StaticScenes()]);
  const identity = productionPacker[V3_INTEGRATION_API]();
  assert.equal(scenes.masterSetSha256, v3.authoringIdentity.masterSetSha256);
  assert.equal(scenes.placementSha256, v3.authoringIdentity.placementSha256);
  assert.equal(scenes.integrationIdentitySha256, identity.canonicalSha256);
  assert.equal(scenes.compositorIdentitySha256, identity.compositorIdentitySha256);
  assert.match(scenes.visibleStaticReceiptSha256, /^[a-f0-9]{64}$/u);
  const exactReceipt = KITS.flatMap((kit) => scenes.scenes[kit].visibleStaticLayers
    .map((layer) => ({ kit, ...layer })));
  assert.equal(exactReceipt.length, 2_040);
  assert.equal(scenes.visibleStaticReceiptSha256, canonicalDigest(exactReceipt));
  assert.equal(scenes.authoringIdentitySha256, canonicalDigest(v3.authoringIdentity));
  const expectedTrust = {
    schema: "regional-r5-v3-static-trust/v1",
    masterSetSha256: scenes.masterSetSha256,
    placementSha256: scenes.placementSha256,
    authoringIdentitySha256: scenes.authoringIdentitySha256,
    landmarkPortReceiptSha256: v3.authoringIdentity.landmarkPortReceiptSha256,
    integrationIdentitySha256: scenes.integrationIdentitySha256,
    compositorIdentitySha256: scenes.compositorIdentitySha256,
    visibleStaticReceiptSha256: scenes.visibleStaticReceiptSha256,
    sceneRgbaSha256: Object.fromEntries(KITS.map((kit) => [kit, scenes.scenes[kit].rgbaSha256])),
  };
  assert.deepEqual(scenes.trustedV3, {
    ...expectedTrust,
    canonicalSha256: canonicalDigest(expectedTrust),
  });
  assertDeeplyFrozen(scenes.trustedV3, "V3 static trust");
});

test("dynamic compositor accepts trusted V3 static output and rejects a self-rehashed pixel flip", {
  skip: API_SKIP,
}, async () => {
  const v3 = await v3Build();
  const staticScenes = await v3StaticScenes();
  const dynamicInput = {
    staticScenes,
    dynamicSourceBuffers: await dynamicSourceBuffers(v3.masterBuffers),
    placements: productionPacker.regionalR5DynamicPresentationPlacements(),
  };
  const accepted = await productionPacker.buildRegionalR5DynamicPresentationScenes(dynamicInput);
  assert.equal(accepted.staticGeneration, "v3");
  assert.equal(accepted.staticIntegrationIdentitySha256, staticScenes.integrationIdentitySha256);

  const tampered = cloneValue(staticScenes);
  const scene = tampered.scenes["worn-heartland"];
  scene.raw.data[0] ^= 1;
  scene.rgbaSha256 = sha256(scene.raw.data);
  tampered.trustedV3.sceneRgbaSha256["worn-heartland"] = scene.rgbaSha256;
  tampered.trustedV3.canonicalSha256 = canonicalDigest(Object.fromEntries(
    Object.entries(tampered.trustedV3).filter(([key]) => key !== "canonicalSha256"),
  ));
  await expectCode(productionPacker.buildRegionalR5DynamicPresentationScenes({
    ...dynamicInput,
    staticScenes: tampered,
  }), "V3_STATIC_TRUST_MISMATCH");
});

test("V3 placement data and atomic-source module contain no scene-position dynamic masks", {
  skip: API_SKIP,
}, async () => {
  const v3 = await v3Build();
  const placementKeys = new Set(collectKeys(v3.placements));
  for (const field of FORBIDDEN_AUTHORING_FIELDS) {
    assert.equal(placementKeys.has(field), false, `V3 placements expose forbidden ${field}`);
  }

  const source = await readFile(V3_SOURCE_MODULE, "utf8");
  for (const field of FORBIDDEN_AUTHORING_FIELDS) {
    assert.doesNotMatch(source, new RegExp(`\\b${field}\\b`, "u"),
      `V3 source reaches forbidden scene-position authoring field ${field}`);
  }
});
