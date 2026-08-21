import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as productionPacker from "./pack-2d-production-assets.mjs";
import {
  REGIONAL_R5_AUTHORING_SPEC,
  REGIONAL_R5_KEY_SCENES,
  REGIONAL_R5_LITERAL_PATCHES,
  REGIONAL_R5_MECHANICS_BINDINGS,
  validateRegionalR5AuthoringSpec,
} from "./regional-art-r5-authoring-spec.mjs";

const REGION_GUIDE = new URL(
  "../../scratchpad/2d-production-art/source/imagegen-concepts/region-kits-imagegen-guide.png",
  import.meta.url,
);
const HOME_RUIN_GUIDE = new URL(
  "../../scratchpad/2d-production-art/source/imagegen-concepts/home-ruin-imagegen-guide.png",
  import.meta.url,
);
const NATIVE_ASSET_ROOT = new URL(
  "../../scratchpad/2d-production-art/source/native/",
  import.meta.url,
);
const KIT = "worn-heartland";
const WORN_ROLES = [
  "worn-ground-foundation",
  "worn-oak-root-foundation",
  "worn-worked-garden-foundation",
  "worn-trampled-lane",
  "worn-home-yard-history",
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

let authoringPromise;
const regionalR5Authoring = async () => {
  authoringPromise ??= productionPacker.buildRegionalR5SourceMasters({
    sourceBuffers: {
      regionKits: await readFile(REGION_GUIDE),
      homeRuin: await readFile(HOME_RUIN_GUIDE),
    },
  });
  return authoringPromise;
};

const completeProofSources = async () => ({
  homeComponents: await readFile(new URL(`homes/${KIT}/components.png`, NATIVE_ASSET_ROOT)),
  humanBody: await readFile(new URL("core/human-body-rigs.png", NATIVE_ASSET_ROOT)),
  humanFace: await readFile(new URL("core/human-face-planes.png", NATIVE_ASSET_ROOT)),
  humanHair: await readFile(new URL("core/human-hair.png", NATIVE_ASSET_ROOT)),
  humanClothing: await readFile(new URL("core/human-clothing-00.png", NATIVE_ASSET_ROOT)),
});

test("Task12R R5 Worn owns exactly five closed source-foundation roles", () => {
  assert.deepEqual(
    REGIONAL_R5_LITERAL_PATCHES.roleOrder.filter((role) => WORN_ROLES.includes(role)),
    WORN_ROLES,
  );
  assert.deepEqual(Object.fromEntries(WORN_ROLES.map((role) => [
    role,
    REGIONAL_R5_LITERAL_PATCHES.roleBindings[role],
  ])), {
    "worn-ground-foundation": ["worn:r5-actorless-world"],
    "worn-oak-root-foundation": ["worn:r5-oak-root-foundation"],
    "worn-worked-garden-foundation": ["worn:r5-worked-garden-foundation"],
    "worn-trampled-lane": ["worn:r5-trampled-lane"],
    "worn-home-yard-history": ["worn:r5-home-yard-history"],
  });
  const sceneRoles = REGIONAL_R5_KEY_SCENES[KIT].literalPatchLayers
    .filter(({ role }) => WORN_ROLES.includes(role))
    .map(({ role }) => role);
  assert.deepEqual(sceneRoles, WORN_ROLES, "every Worn foundation role is placed exactly once");
  assert.equal(new Set(sceneRoles).size, 5);
});

test("Task12R R5 Worn preserves exact R4 mechanics and exact presentation depth", async () => {
  const mechanics = REGIONAL_R5_MECHANICS_BINDINGS.scenePlans[KIT];
  assert.equal(mechanics.routeTiles.length, 29);
  assert.deepEqual(mechanics.waterTiles, []);
  assert.deepEqual(mechanics.shoreTiles, []);
  assert.deepEqual(mechanics.bridgeTiles, []);
  assert.equal(sha256(Buffer.from(JSON.stringify(mechanics.routeTiles))),
    "4dd5fcd6f8124b413d12e42b0729cb1b8a7577d3bf9c0b376bb5b98d3eca24d2");
  assert.deepEqual(mechanics.terrainPatches.map(({ tiles }) => tiles), [
    Array.from({ length: 12 }, (_unused, index) => ({ x: 5 + index % 4, y: 5 + Math.floor(index / 4) })),
    Array.from({ length: 12 }, (_unused, index) => ({ x: 15 + index % 4, y: 11 + Math.floor(index / 4) })),
  ]);
  assert.deepEqual(mechanics.yard.originPx, { x: 528, y: 320 });
  assert.deepEqual(mechanics.home.plotCenterPx, { x: 560, y: 336 });
  assert.deepEqual(mechanics.home.doorCenterPx, { x: 624, y: 432 });

  const complete = await productionPacker.buildRegionalR5CompleteProofScene({
    kit: KIT,
    authoring: await regionalR5Authoring(),
    sourceBuffers: completeProofSources(),
  });
  assert.equal(complete.rgbaSha256,
    "21e6997c655833aab5816adc914411771da82c1cc40e57a0b5ce6cf75ed28285");
  assert.equal(complete.pngSha256,
    "2566a2bb706feaf171350b6f28f942acd0112103f3ad151c905b094ebcdf9e63");
  const shelter = complete.humanWitnesses.find(({ placement }) => placement.role === "shelter-door");
  assert.deepEqual({ x: shelter.placement.x, y: shelter.placement.y }, { x: 640, y: 399 });
  assert.deepEqual(shelter.feet, { x: 664, y: 460 });
  assert.equal(complete.productionHuman.patchRgbaSha256,
    "4bcdc9f7fc15ab203eb96e99cb1108c3b884e198be284c6b958170f9f5f67e0e");
  assert.equal(complete.humanWitnesses.length, 3);
  assert.equal(complete.entranceDepth.portalHumanOverlap, 0);
  assert.equal(complete.entranceDepth.foregroundHumanOverlap, 0);
  assert.deepEqual(productionPacker.regionalR5AlphaComponentSizes(complete.entranceDepth.contactShadows),
    [80, 80, 80]);
  assert.equal(complete.homeActor.proofRgbaSha256,
    "3ed48928df32d08ec72d90e1ae69401c7d2b86bea0cf315403ee7f12391dbb5c");
  assert.equal(sha256(complete.homeActor.patch.data),
    "8e5b798d06b6b2657c017cc5be54e2397ff7267d7e5e306ba385754574102ffb");
  assert.equal(complete.homeActor.frontPatchRgbaSha256,
    "b8a0e956785ecd6f60059b6e308354200cf23896fe99446f525a30cfd4e3286e");
});

test("Task12R R5 Worn relation oracle derives joined landscape topology only from trusted source", async () => {
  assert.equal(typeof productionPacker.measureRegionalR5WornRelations, "function");
  const measurement = await productionPacker.measureRegionalR5WornRelations({
    authoring: await regionalR5Authoring(),
  });
  assert.equal(measurement.routeTileCount, 29);
  assert.equal(measurement.oakRootComponentCount, 1);
  assert.ok(measurement.southGardenOpeningPx >= 32);
  assert.ok(measurement.eastGardenOpeningPx >= 32);
  assert.equal(measurement.laneConnected, true);
  assert.equal(measurement.eastWestShoulderTouchesLane, true);
  assert.equal(measurement.northSouthShoulderTouchesLane, true);
  assert.equal(measurement.laneTouchesYardSouthPort, true);
  assert.deepEqual(measurement.yardSouthPortCorridor,
    { left: 608, right: 640, top: 432, bottom: 480 });
  assert.equal(measurement.timberTouchesYardHistory, true);
  assert.equal(measurement.stoneTouchesYardHistory, true);
  assert.deepEqual(measurement.landmarkFoundationReceipts.map(({
    cell, foundationRole, touchesFoundation,
  }) => ({ cell, foundationRole, touchesFoundation })), [
    { cell: 0, foundationRole: "worn-oak-root-foundation", touchesFoundation: true },
    { cell: 1, foundationRole: "worn-oak-root-foundation", touchesFoundation: true },
    { cell: 2, foundationRole: "worn-oak-root-foundation", touchesFoundation: true },
    { cell: 3, foundationRole: "worn-worked-garden-foundation", touchesFoundation: true },
    { cell: 4, foundationRole: "worn-worked-garden-foundation", touchesFoundation: true },
    { cell: 5, foundationRole: "worn-worked-garden-foundation", touchesFoundation: true },
    { cell: 6, foundationRole: "worn-trampled-lane", touchesFoundation: true },
    { cell: 7, foundationRole: "worn-trampled-lane", touchesFoundation: true },
  ]);
  assert.equal(measurement.successorReceipt.canonicalSha256,
    "aeff67bf2976ab04d7955658a19771ea2928b5ae284490889edb3012a6b3dd95");
  assert.deepEqual(measurement.actorWitnessReceipts.map(({
    role, facing, relationshipValid,
  }) => ({ role, facing, relationshipValid })), [
    { role: "route-entry", facing: "south", relationshipValid: true },
    { role: "defining-landmark", facing: "south", relationshipValid: true },
    { role: "shelter-door", facing: "south", relationshipValid: true },
  ]);
  assert.deepEqual(measurement.errors, []);
  await assert.rejects(async () => productionPacker.measureRegionalR5WornRelations({
    authoring: await regionalR5Authoring(),
    minimumOpeningPx: 1,
  }), /candidate|knob|forbidden|unexpected/i);
});

test("Task12R R5 Worn relation analyzer rejects recolor, sealed openings, detached roots, and severed lane", async () => {
  assert.equal(typeof productionPacker.analyzeRegionalR5WornRelations, "function");
  const authoring = await regionalR5Authoring();
  const inputs = productionPacker.regionalR5WornRelationInputs({ authoring });
  const copy = (input) => ({ ...input, data: Buffer.from(input.data) });
  const mutate = (name, callback) => {
    const candidate = Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, copy(value)]));
    callback(candidate);
    const measured = productionPacker.analyzeRegionalR5WornRelations(candidate);
    assert.ok(measured.errors.some((error) => error.includes(name)), measured.errors.join("\n"));
  };
  mutate("palette", ({ trampledLane }) => {
    for (let offset = 0; offset < trampledLane.data.length; offset += 4) {
      if (trampledLane.data[offset + 3] === 0) continue;
      trampledLane.data.set([136, 165, 141, 255], offset);
    }
  });
  mutate("garden-opening", ({ landmark3, landmark4 }) => {
    for (let x = 131; x < 234; x += 1) {
      landmark3.data.set([111, 80, 53, 255], (254 * 768 + x) * 4);
    }
    for (let y = 150; y < 260; y += 1) {
      landmark4.data.set([111, 80, 53, 255], (y * 768 + 340) * 4);
    }
  });
  mutate("oak-root", ({ oakRootFoundation }) => {
    for (let y = 0; y < 512; y += 1) for (let x = 188; x < 204; x += 1) {
      oakRootFoundation.data.fill(0, (y * 768 + x) * 4, (y * 768 + x + 1) * 4);
    }
  });
  mutate("lane-connectivity", ({ trampledLane }) => {
    for (let y = 0; y < 512; y += 1) for (let x = 344; x < 376; x += 1) {
      trampledLane.data.fill(0, (y * 768 + x) * 4, (y * 768 + x + 1) * 4);
    }
  });
  mutate("yard-contact", ({ trampledLane }) => {
    for (let y = 432; y < 480; y += 1) for (let x = 608; x < 640; x += 1) {
      trampledLane.data.fill(0, (y * 768 + x) * 4, (y * 768 + x + 1) * 4);
    }
  });
  mutate("source-hash", ({ landmark0 }) => {
    const firstOpaqueOffset = landmark0.data.findIndex((value, offset) => offset % 4 === 3 && value !== 0) - 3;
    landmark0.data[firstOpaqueOffset] ^= 0xff;
  });
});

test("Task12R R5 Worn source reconstruction pins one actorless world and eight addressable landmarks", async () => {
  const authoring = await regionalR5Authoring();
  const patchById = new Map(REGIONAL_R5_LITERAL_PATCHES.patches.map((patch) => [patch.id, patch]));
  const landmarkIds = Array.from({ length: 8 }, (_unused, index) => `worn:r5-landmark-${index}`);
  assert.ok(patchById.has("worn:r5-actorless-world"));
  assert.ok(landmarkIds.every((id) => patchById.has(id)));
  assert.equal(new Set(landmarkIds.map((id) => patchById.get(id).canonicalSha256)).size, 8);
  const world = await productionPacker.buildRegionalR5KeyScene({ kit: KIT, authoring });
  const sourceWorld = productionPacker.realizeRegionalR5IndexedPatch(
    patchById.get("worn:r5-actorless-world"),
  );
  assert.equal(sha256(world.raw.data),
    "639bbaa042ae538abc001927d5e466568155f1950b78923eeb8e3d0e4ea8a206");
  assert.equal(sha256(world.buffer),
    "3e1b945d2cb8aeebd1a8a568e6b930471b9eaf49b59e64fcc24fb5978cd94b67");
  assert.equal(sha256(world.raw.data), sha256(sourceWorld.data));

  const atlas = authoring.rawMasters[`${KIT}-landmarks`];
  assert.equal(sha256(atlas.data),
    "9caba437f2ca74080709d7154c318c255089152516b9e7d1e7541b27319aeb28");
  assert.equal(sha256(authoring.buffers[`${KIT}-landmarks`]),
    "3ffe17aa59c5a1be858a747af9137caf4481b67aadac7db0b50fd4c5d843a6ed");
  for (let cell = 0; cell < 8; cell += 1) {
    const patch = productionPacker.realizeRegionalR5IndexedPatch(patchById.get(landmarkIds[cell]));
    const sourceX = cell % 4 * 128;
    const sourceY = Math.floor(cell / 4) * 128;
    const actual = Buffer.alloc(128 * 128 * 4);
    for (let y = 0; y < 128; y += 1) atlas.data.copy(
      actual,
      y * 128 * 4,
      ((sourceY + y) * atlas.width + sourceX) * 4,
      ((sourceY + y) * atlas.width + sourceX + 128) * 4,
    );
    assert.equal(sha256(actual), sha256(patch.data), `landmark cell ${cell} reconstructs exact source`);
  }
  assert.deepEqual(
    REGIONAL_R5_KEY_SCENES[KIT].landmarkLayers.map(({ variantId }) => variantId),
    [
      "worn-heartland:broad-crown",
      "worn-heartland:split-crown",
      "worn-heartland:wind-worn-crown",
      "worn-heartland:open-south-gap",
      "worn-heartland:open-east-gap",
      "worn-heartland:diagonal-reclaimed-boundary",
      "worn-heartland:left-right-shoulder",
      "worn-heartland:top-bottom-shoulder",
    ],
  );
});

test("Task12R R5 Worn authority rejects duplicate roles, refreshed outer digests, and mechanics drift", () => {
  const duplicateRole = structuredClone(REGIONAL_R5_AUTHORING_SPEC);
  duplicateRole.literalPatches.roleOrder.push("worn-ground-foundation");
  assert.deepEqual(validateRegionalR5AuthoringSpec(duplicateRole), [
    "indexed patch role schema owner palette content hash drift",
  ], "the isolated duplicate role must produce the indexed-patch role diagnostic");

  const refreshed = structuredClone(REGIONAL_R5_AUTHORING_SPEC);
  refreshed.keyScenes[KIT].literalPatchLayers[0].x += 1;
  refreshed.digests.keySceneManifest.scenes.find(({ kitId }) => kitId === KIT).keySceneSha256 = "0".repeat(64);
  refreshed.digests.keySceneManifest.canonicalSha256 = "1".repeat(64);
  assert.notDeepEqual(validateRegionalR5AuthoringSpec(refreshed), []);

  const mechanicsDrift = structuredClone(REGIONAL_R5_AUTHORING_SPEC);
  mechanicsDrift.mechanicsBindings.scenePlans[KIT].routeTiles.pop();
  assert.notDeepEqual(validateRegionalR5AuthoringSpec(mechanicsDrift), []);
});
