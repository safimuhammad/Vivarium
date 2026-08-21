/**
 * RED contract for replacing scene-derived R5 masters with atomic sources.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import sharp from "sharp";

import {
  REGIONAL_R5_V3_ATOMIC_LITERAL_AUTHORITY,
} from "./fixtures/regional-art-r5-v3-atomic-literal-authority.mjs";
import {
  regionalR5AtlasOnlyScenePlacementsInternal,
} from "./regional-art-r5-atlas-only-scene.mjs";
import * as productionPacker from "./pack-2d-production-assets.mjs";

const AUTHORITY = REGIONAL_R5_V3_ATOMIC_LITERAL_AUTHORITY;
const API_NAME = AUTHORITY.productionApi;
const API_READY = typeof productionPacker[API_NAME] === "function";
const API_SKIP = API_READY ? false : `V3_ATOMIC_RED/API_MISSING: ${API_NAME}`;
const KIT_NAMES = Object.freeze(Object.keys(AUTHORITY.landmarks));
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

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

function assertExactKeys(value, expected, label) {
  assert.deepEqual(Object.keys(value).sort(compareText), [...expected].sort(compareText), label);
}

function assertDeeplyFrozen(value, label) {
  assert.equal(Object.isFrozen(value), true, `${label}: value must be frozen`);
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (child !== null && typeof child === "object") assertDeeplyFrozen(child, `${label}.${key}`);
  }
}

function literalLandmarks() {
  return KIT_NAMES.flatMap((kit) => AUTHORITY.landmarks[kit].map(([cell, sourceId]) => ({
    kit,
    cell,
    sourceId,
  })));
}

function literalSupports() {
  return KIT_NAMES.flatMap((kit) => (
    AUTHORITY.supportPlacements[kit].map(([cell, sceneX, sceneY, role, sourceIds]) => ({
      kit,
      role,
      sceneX,
      sceneY,
      cell,
      sourceIds,
    }))
  ));
}

function build() {
  return productionPacker[API_NAME]({ authority: AUTHORITY });
}

test("V3 atomic-source builder is exposed by the production packer", () => {
  assert.equal(
    typeof productionPacker[API_NAME],
    "function",
    `V3_ATOMIC_RED/API_MISSING: ${API_NAME}`,
  );
});

test("literal authority pins the exact twenty masters, forty landmarks, and eighty supports", {
  skip: API_SKIP,
}, () => {
  const expectedMasterNames = KIT_NAMES.flatMap((kit) => (
    AUTHORITY.masterBoundary.families.map((family) => `${kit}-${family}`)
  )).sort(compareText);
  assert.equal(AUTHORITY.masterBoundary.count, 20);
  assert.deepEqual(Object.keys(AUTHORITY.masterBoundary.pngExpectations).sort(compareText), expectedMasterNames);
  assert.equal(Object.values(AUTHORITY.masterBoundary.pngExpectations).every((expectation) => (
    expectation.length === 5 && expectation.slice(0, 3).every(Number.isSafeInteger)
      && expectation[3] === true
  )), true);

  const landmarks = literalLandmarks();
  assert.equal(KIT_NAMES.length, 5);
  assert.equal(landmarks.length, 40);
  assert.equal(new Set(landmarks.map(({ sourceId }) => sourceId)).size, 40);
  for (const kit of KIT_NAMES) {
    assert.deepEqual(AUTHORITY.landmarks[kit].map(([cell]) => cell), [0, 1, 2, 3, 4, 5, 6, 7]);
  }

  const supports = literalSupports();
  assert.equal(supports.length, 80);
  assert.equal(supports.every(({ sourceIds }) => sourceIds.length > 0), true);
  for (const kit of KIT_NAMES) {
    assert.equal(AUTHORITY.supportPlacements[kit].length, 16);
    assert.equal(new Set(AUTHORITY.supportPlacements[kit].map(([cell]) => cell)).size, 16,
      `${kit}: every audited support role must own a distinct scenery cell`);
  }
});

test("literal authority closes operations, caller inputs, and source ownership", {
  skip: API_SKIP,
}, () => {
  assert.deepEqual(AUTHORITY.allowedOperations, [
    "integer-crop",
    "integer-translation",
    "transparent-padding",
    "alpha-over",
    "palette-normalization",
  ]);
  assert.deepEqual(AUTHORITY.closedInputKeys, ["authority"]);
  assert.deepEqual(AUTHORITY.forbiddenInputKeys, [
    "forbidden", "extra", "sceneMask", "humanRects", "homeRect", "sceneX", "sceneY",
  ]);
  const { literals, patterns } = AUTHORITY.forbiddenSources;
  assert.equal(new Set(literals).size, literals.length);
  assert.ok(literals.length >= 30);
  assert.deepEqual(patterns.map((pattern) => new RegExp(pattern, "u").source), patterns);
  const permittedIds = [
    ...literalLandmarks().map(({ sourceId }) => sourceId),
    ...literalSupports().flatMap(({ sourceIds }) => sourceIds),
  ];
  assert.equal(permittedIds.some((sourceId) => literals.includes(sourceId)), false);
  assert.deepEqual(AUTHORITY.positiveSources["neutral:v3-explicit-plain-bench"], {
    owner: "region-kits",
    sourcePath: "scratchpad/2d-production-art/source/imagegen-concepts/region-kits-imagegen-guide.png",
    sourceRect: [1362, 816, 67, 51],
    normalizedRect: [681, 408, 34, 26],
    cropRect: [1, 0, 32, 26],
    destinationOffset: [0, 6],
  });
});

test("all eighty support roles retain atlas-only scene coordinates and only audited cells remap", {
  skip: API_SKIP,
}, () => {
  const atlasOnly = regionalR5AtlasOnlyScenePlacementsInternal();
  for (const kit of KIT_NAMES) {
    const before = atlasOnly.scenes[kit].visibleStaticLayers.filter(({ id }) => id.includes("/support/"));
    const after = AUTHORITY.supportPlacements[kit];
    assert.equal(before.length, 16, `${kit}: literal atlas-only authority must expose sixteen supports`);
    assert.equal(after.length, before.length);
    for (let index = 0; index < before.length; index += 1) {
      const [cell, sceneX, sceneY, role] = after[index];
      const prior = before[index];
      assert.equal(role, prior.role, `${kit}/${index}: support role drift`);
      assert.deepEqual({ x: sceneX, y: sceneY }, prior.destination,
        `${kit}/${role}: scene coordinates must remain exact`);
      if (cell === prior.cell) continue;
      const remap = AUTHORITY.collisionRemaps.find((entry) => (
        entry.kit === kit && entry.collidedCell === prior.cell
      ));
      assert.ok(remap, `${kit}/${role}: only an audited collision may change destination cell`);
      assert.deepEqual(remap.assignments.find(([assignmentRole]) => assignmentRole === role), [role, cell],
        `${kit}/${role}: remap destination must equal the audited assignment`);
    }
  }
});

test("builder rejects every forbidden or extra caller-controlled scene input", {
  skip: API_SKIP,
}, async () => {
  for (const key of AUTHORITY.forbiddenInputKeys) {
    await assert.rejects(
      async () => productionPacker[API_NAME]({ authority: AUTHORITY, [key]: {} }),
      /closed|forbidden|only authority|unexpected/iu,
      `${key}: caller-controlled scene input must reject`,
    );
  }
});

test("builder returns exactly twenty nonempty PNG masters with closed geometry", {
  skip: API_SKIP,
}, async () => {
  const result = await build();
  assertExactKeys(result, AUTHORITY.resultContract.fields, "builder result fields drifted");
  assert.equal(result.schema, AUTHORITY.resultContract.schema);
  assert.deepEqual(result.authority, AUTHORITY);
  assert.deepEqual(
    Object.keys(result.masterBuffers).sort(compareText),
    Object.keys(AUTHORITY.masterBoundary.pngExpectations).sort(compareText),
  );
  for (const [name, [width, height, channels, nonempty]] of Object.entries(
    AUTHORITY.masterBoundary.pngExpectations,
  )) {
    const buffer = result.masterBuffers[name];
    assert.equal(Buffer.isBuffer(buffer), true, `${name}: encoded master must be a Buffer`);
    const metadata = await sharp(buffer).metadata();
    assert.equal(metadata.format, "png", `${name}: master must be encoded as PNG`);
    assert.deepEqual([metadata.width, metadata.height, metadata.channels], [width, height, channels],
      `${name}: exact PNG geometry drifted`);
    const { data } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const hasOpaquePixel = data.some((_channel, offset) => offset % 4 === 3 && data[offset] !== 0);
    assert.equal(hasOpaquePixel, nonempty, `${name}: decoded nonempty expectation drifted`);
  }
});

test("immutable receipt has exact recomputable lineage for every landmark and support", {
  skip: API_SKIP,
}, async () => {
  const result = await build();
  const { receipt } = result;
  const contract = AUTHORITY.receiptContract;
  assertExactKeys(receipt, contract.fields, "receipt fields drifted");
  assert.equal(receipt.schema, contract.schema);
  assert.equal(receipt.authoritySha256, canonicalDigest(AUTHORITY));
  assertExactKeys(receipt.masterPngSha256, Object.keys(result.masterBuffers), "receipt master hashes drifted");
  for (const [name, buffer] of Object.entries(result.masterBuffers)) {
    assert.equal(receipt.masterPngSha256[name], sha256(buffer), `${name}: receipt PNG hash must be byte-derived`);
  }
  assert.equal(receipt.cells.length, 120);
  assert.equal(receipt.supportPlacements.length, 80);
  assert.equal(new Set(receipt.cells.map(({ atlasId, cell }) => `${atlasId}:${cell}`)).size, 120);
  assert.equal(result.placements.schema, "regional-r5-v3-atlas-only-placement-authority/v1");
  assert.equal(result.placements.canonicalSha256,
    canonicalDigest(Object.fromEntries(Object.entries(result.placements).filter(([key]) => (
      key !== "canonicalSha256"
    )))));
  const expectedAuthoringIdentityBody = {
    schema: "regional-r5-v3-authoring-identity/v1",
    authoritySha256: receipt.authoritySha256,
    receiptSha256: receipt.canonicalSha256,
    landmarkPortReceiptSha256: receipt.landmarkPortReceiptSha256,
    masterSetSha256: canonicalDigest(receipt.masterPngSha256),
    placementSha256: result.placements.canonicalSha256,
  };
  assert.deepEqual(result.authoringIdentity, {
    ...expectedAuthoringIdentityBody,
    canonicalSha256: canonicalDigest(expectedAuthoringIdentityBody),
  });

  const cellByDestination = new Map(receipt.cells.map((entry) => [`${entry.atlasId}:${entry.cell}`, entry]));
  for (const expected of literalLandmarks()) {
    const entry = cellByDestination.get(`${expected.kit}-landmarks:${expected.cell}`);
    assert.ok(entry, `${expected.kit}/landmark/${expected.cell}: cell lineage required`);
    assertExactKeys(entry, contract.cellFields, `${expected.kit}/landmark/${expected.cell}: lineage fields drifted`);
    assert.equal(entry.family, "landmarks");
    assert.equal(entry.sourceKind, contract.sourceKinds.landmark);
    assert.deepEqual(entry.sourceIds, [expected.sourceId]);
    assert.deepEqual(entry.sourceOperations, [{
      sourceId: expected.sourceId,
      sourceRgbaSha256: entry.afterRgbaSha256,
      cropRect: [0, 0, 128, 128],
      destination: [0, 0],
    }]);
    assert.equal(entry.sourceRgbaSha256, entry.afterRgbaSha256,
      `${expected.kit}/landmark/${expected.cell}: complete landmark anatomy must remain source-exact`);
  }

  for (let index = 0; index < literalSupports().length; index += 1) {
    const expected = literalSupports()[index];
    const placement = receipt.supportPlacements[index];
    assertExactKeys(placement, contract.supportPlacementFields,
      `${expected.kit}/${expected.role}: support receipt fields drifted`);
    assert.deepEqual({
      kit: placement.kit,
      role: placement.role,
      sceneX: placement.sceneX,
      sceneY: placement.sceneY,
      cell: placement.cell,
      sourceIds: placement.sourceIds,
    }, expected, `${expected.kit}/${expected.role}: support placement authority drifted`);
    assert.match(placement.resultRgbaSha256, SHA256_PATTERN,
      `${expected.kit}/${expected.role}: non-null byte-derived result hash required before GREEN`);

    const entry = cellByDestination.get(`${expected.kit}-scenery:${expected.cell}`);
    assert.ok(entry, `${expected.kit}/${expected.role}: scenery cell lineage required`);
    assertExactKeys(entry, contract.cellFields, `${expected.kit}/${expected.role}: lineage fields drifted`);
    assert.equal(entry.family, "scenery");
    assert.equal(entry.sourceKind, contract.sourceKinds.support);
    assert.deepEqual(entry.sourceIds, expected.sourceIds);
    assert.equal(entry.sourceOperations.length, expected.sourceIds.length);
    assert.deepEqual(entry.sourceOperations.map(({ sourceId }) => sourceId), expected.sourceIds);
    for (const operation of entry.sourceOperations) {
      assertExactKeys(operation, ["sourceId", "sourceRgbaSha256", "cropRect", "destination"],
        `${expected.kit}/${expected.role}/${operation.sourceId}: source operation fields drifted`);
      assert.match(operation.sourceRgbaSha256, SHA256_PATTERN);
      assert.equal(operation.cropRect.length, 4);
      assert.equal(operation.destination.length, 2);
      assert.equal([...operation.cropRect, ...operation.destination].every(Number.isSafeInteger), true);
    }
    assert.equal(entry.afterRgbaSha256, placement.resultRgbaSha256);
    const staticPlacement = result.placements.scenes[expected.kit].visibleStaticLayers
      .find(({ role, destination }) => role === expected.role
        && destination.x === expected.sceneX && destination.y === expected.sceneY);
    assert.ok(staticPlacement, `${expected.kit}/${expected.role}: detached V3 placement required`);
    assert.equal(staticPlacement.cell, expected.cell);
  }

  for (const entry of receipt.cells) {
    assert.match(entry.beforeRgbaSha256, SHA256_PATTERN);
    assert.match(entry.sourceRgbaSha256, SHA256_PATTERN);
    assert.match(entry.afterRgbaSha256, SHA256_PATTERN);
    assert.match(entry.encodedMasterPngSha256, SHA256_PATTERN);
    assert.equal(entry.beforeRgbaSha256 === entry.afterRgbaSha256, false,
      `${entry.atlasId}/${entry.cell}: V3 target must record a real replacement`);
    assert.equal(entry.encodedMasterPngSha256, receipt.masterPngSha256[entry.atlasId]);
    assert.equal(Array.isArray(entry.orderedOperations) && entry.orderedOperations.length > 0, true);
    assert.equal(entry.orderedOperations.every((operation) => AUTHORITY.allowedOperations.includes(operation)), true);
    assert.equal(Array.isArray(entry.supersededHistory), true);
  }
  const digestBody = Object.fromEntries(Object.entries(receipt).filter(([key]) => (
    key !== contract.digestField
  )));
  assert.match(receipt.canonicalSha256, SHA256_PATTERN);
  assert.equal(receipt.canonicalSha256, canonicalDigest(digestBody));
  assertDeeplyFrozen(receipt, "receipt");
});

test("terrain and home-yards remain exact across three deterministic builds", {
  skip: API_SKIP,
}, async () => {
  const builds = await Promise.all([build(), build(), build()]);
  const snapshots = builds.map(({ masterBuffers, receipt }) => ({
    masterPngSha256: Object.fromEntries(Object.entries(masterBuffers).map(([name, buffer]) => (
      [name, sha256(buffer)]
    ))),
    receiptSha256: receipt.canonicalSha256,
  }));
  assert.deepEqual(snapshots[1], snapshots[0]);
  assert.deepEqual(snapshots[2], snapshots[0]);

  const unchanged = Object.entries(AUTHORITY.masterBoundary.pngExpectations)
    .filter(([, expectation]) => expectation[4] !== null);
  assert.equal(unchanged.length, 10);
  assert.equal(unchanged.every(([name]) => /-(?:terrain|home-yards)$/u.test(name)), true);
  for (const [name, [, , , , expectedPngSha256]] of unchanged) {
    assert.equal(snapshots[0].masterPngSha256[name], expectedPngSha256,
      `${name}: V3 must not alter terrain or home-yard bytes`);
  }
});
