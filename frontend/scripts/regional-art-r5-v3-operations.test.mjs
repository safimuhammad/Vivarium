/**
 * RED contract for exact V3 support-source operations and final cell bytes.
 *
 * Expected cells are rebuilt here from trusted source raws plus a test-owned
 * operation authority. The production module's private operation table is not
 * imported or evaluated.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import sharp from "sharp";

import {
  REGIONAL_R5_AUTHORING_SOURCES,
  REGIONAL_R5_PALETTES,
} from "./regional-art-r5-authoring-spec.mjs";
import {
  REGIONAL_R5_V3_ATOMIC_LITERAL_AUTHORITY,
} from "./fixtures/regional-art-r5-v3-atomic-literal-authority.mjs";
import {
  REGIONAL_R5_V3_OPERATIONS_LITERAL_AUTHORITY,
  REGIONAL_R5_V3_OPERATIONS_LITERAL_AUTHORITY_SHA256,
} from "./fixtures/regional-art-r5-v3-operations-literal-authority.mjs";
import * as productionPacker from "./pack-2d-production-assets.mjs";

const ATOMIC = REGIONAL_R5_V3_ATOMIC_LITERAL_AUTHORITY;
const OPERATIONS = REGIONAL_R5_V3_OPERATIONS_LITERAL_AUTHORITY;
const KITS = Object.freeze(Object.keys(ATOMIC.supportPlacements));
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const OPERATION_FIELDS = Object.freeze([
  "cropRect",
  "destination",
  "sourceId",
  "sourceRgbaSha256",
]);

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

function cropRaw(source, rect, label) {
  assert.deepEqual(rect.length, 4, `${label}: crop must have four integers`);
  const [x, y, width, height] = rect;
  assert.equal(rect.every(Number.isSafeInteger), true, `${label}: crop must use integers`);
  assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0
    && x + width <= source.width && y + height <= source.height,
  `${label}: crop must remain inside the source`);
  const data = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const start = ((y + row) * source.width + x) * 4;
    source.data.copy(data, row * width * 4, start, start + width * 4);
  }
  return { data, width, height, channels: 4 };
}

function alphaOver(destination, source, x, y, label) {
  assert.equal(Number.isSafeInteger(x) && Number.isSafeInteger(y), true,
    `${label}: destination must use integers`);
  assert.ok(x >= 0 && y >= 0 && x + source.width <= destination.width
    && y + source.height <= destination.height, `${label}: destination must remain inside 32x32`);
  for (let sourceY = 0; sourceY < source.height; sourceY += 1) {
    for (let sourceX = 0; sourceX < source.width; sourceX += 1) {
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const alpha = source.data[sourceOffset + 3];
      assert.ok(alpha === 0 || alpha === 255, `${label}: source alpha must be binary`);
      if (alpha === 0) continue;
      const destinationOffset = (
        (y + sourceY) * destination.width + x + sourceX
      ) * 4;
      source.data.copy(destination.data, destinationOffset, sourceOffset, sourceOffset + 4);
    }
  }
}

function operationFor(kit, role, sourceId) {
  return OPERATIONS.roleOverrides[`${kit}/${role}/${sourceId}`]
    ?? OPERATIONS.sourceOperations[sourceId];
}

function expectedOperation(kit, role, sourceId) {
  const operation = operationFor(kit, role, sourceId);
  assert.ok(operation, `${kit}/${role}/${sourceId}: literal operation missing`);
  return {
    sourceId,
    sourceRgbaSha256: OPERATIONS.sourceRgbaSha256[sourceId],
    cropRect: [...operation.cropRect],
    destination: [...operation.destination],
  };
}

const probe = await (async () => {
  try {
    const result = await productionPacker.buildRegionalR5V3AtomicSourceMasters({ authority: ATOMIC });
    const supportCells = result.receipt.cells.filter(({ family }) => family === "scenery");
    const invalid = supportCells.flatMap((cell) => cell.sourceOperations
      .filter((operation) => canonicalJson(Object.keys(operation).sort(compareText))
        !== canonicalJson(OPERATION_FIELDS))
      .map((operation) => `${cell.atlasId}:${cell.cell}:${operation.sourceId}`));
    return {
      result,
      failure: supportCells.length === 80 && invalid.length === 0
        ? null
        : `receipt requires 80 cells with individual ${OPERATION_FIELDS.join("/")}; invalid ${invalid.length}`,
    };
  } catch (error) {
    return { result: null, failure: `builder failed before receipt inspection: ${error.message}` };
  }
})();
const OPERATIONS_READY = probe.failure === null;
const OPERATIONS_SKIP = OPERATIONS_READY
  ? false
  : `V3_OPERATIONS_RED/RECEIPT_SCHEMA_MISSING: ${probe.failure}`;

let sourcesPromise;
async function trustedPositiveSources() {
  sourcesPromise ??= (async () => {
    const regionKits = await readFile(REGIONAL_R5_AUTHORING_SOURCES.regionKits.path);
    const authoring = await productionPacker.buildRegionalR5SourceMasters({
      sourceBuffers: {
        regionKits,
        homeRuin: await readFile(REGIONAL_R5_AUTHORING_SOURCES.homeRuin.path),
      },
    });
    const sources = new Map([...authoring.fragments, ...authoring.patches]);

    const decoded = await sharp(regionKits).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    const normalized = productionPacker.normalizeRegionalR5WholeSheet({
      data: decoded.data,
      width: decoded.info.width,
      height: decoded.info.height,
      channels: 4,
    });
    const guideBench = cropRaw(normalized, [681, 408, 34, 26], "Neutral bench guide");
    const cleanedBench = productionPacker.cleanRegionalR5Crop({
      ...guideBench,
      palette: REGIONAL_R5_PALETTES.kits["neutral-temperate"],
    });
    sources.set(
      "neutral:v3-explicit-plain-bench",
      cropRaw(cleanedBench, [1, 0, 32, 26], "Neutral bench normalized source"),
    );
    return sources;
  })();
  return sourcesPromise;
}

let expectedCellsPromise;
async function independentExpectedCells() {
  expectedCellsPromise ??= (async () => {
    const sources = await trustedPositiveSources();
    return KITS.flatMap((kit) => ATOMIC.supportPlacements[kit]
      .map(([cell, _sceneX, _sceneY, role, sourceIds]) => {
        const raw = { data: Buffer.alloc(32 * 32 * 4), width: 32, height: 32, channels: 4 };
        for (const sourceId of sourceIds) {
          const source = sources.get(sourceId);
          assert.ok(source, `${kit}/${role}/${sourceId}: trusted source raw missing`);
          const operation = operationFor(kit, role, sourceId);
          const prepared = cropRaw(source, operation.cropRect, `${kit}/${role}/${sourceId}`);
          alphaOver(raw, prepared, ...operation.destination, `${kit}/${role}/${sourceId}`);
        }
        return { kit, cell, role, sourceIds, raw, rgbaSha256: sha256(raw.data) };
      }));
  })();
  return expectedCellsPromise;
}

async function decodedSceneryMasters() {
  return Object.fromEntries(await Promise.all(KITS.map(async (kit) => {
    const bytes = probe.result.masterBuffers[`${kit}-scenery`];
    const { data, info } = await sharp(bytes).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    assert.deepEqual([info.width, info.height, info.channels], [512, 256, 4]);
    return [kit, { data, width: info.width, height: info.height, channels: 4 }];
  })));
}

test("V3 receipt exposes the full individual support-source operation schema", () => {
  assert.equal(
    probe.failure,
    null,
    `V3_OPERATIONS_RED/RECEIPT_SCHEMA_MISSING: ${probe.failure}`,
  );
});

test("literal authority freezes all sixty-six positive sources and eighty result hashes", {
  skip: OPERATIONS_SKIP,
}, () => {
  assert.equal(OPERATIONS.schema, "regional-r5-v3-operations-literal-authority/v1");
  assert.equal(canonicalDigest(OPERATIONS), REGIONAL_R5_V3_OPERATIONS_LITERAL_AUTHORITY_SHA256);
  const usedSourceIds = [...new Set(KITS.flatMap((kit) => (
    ATOMIC.supportPlacements[kit].flatMap(([, , , , sourceIds]) => sourceIds)
  )))].sort(compareText);
  assert.deepEqual(Object.keys(OPERATIONS.sourceOperations).sort(compareText), usedSourceIds);
  assert.deepEqual(Object.keys(OPERATIONS.sourceRgbaSha256).sort(compareText), usedSourceIds);
  assert.equal(usedSourceIds.length, 66);
  assert.equal(Object.values(OPERATIONS.sourceRgbaSha256).every((hash) => SHA256_PATTERN.test(hash)), true);
  assert.equal(Object.values(OPERATIONS.resultCells).flat().length, 80);
  assert.deepEqual(OPERATIONS.sourceOperations["neutral:v3-explicit-plain-bench"], {
    cropRect: [0, 0, 32, 26],
    destination: [0, 6],
  });
  assert.deepEqual(
    OPERATIONS.roleOverrides[
      "ash-waste/fissure-return/r5-regional/ash-waste/fracture-macro-band"
    ],
    { cropRect: [0, 3, 32, 32], destination: [0, 0] },
  );
});

test("trusted source maps and independent guide decoding equal every source hash", {
  skip: OPERATIONS_SKIP,
}, async () => {
  const sources = await trustedPositiveSources();
  for (const [sourceId, expectedHash] of Object.entries(OPERATIONS.sourceRgbaSha256)) {
    const source = sources.get(sourceId);
    assert.ok(source, `${sourceId}: trusted positive source missing`);
    assert.equal(sha256(source.data), expectedHash, `${sourceId}: source RGBA identity drift`);
  }
});

test("independent crops and alpha-over stacks reproduce all eighty frozen result cells", {
  skip: OPERATIONS_SKIP,
}, async () => {
  const cells = await independentExpectedCells();
  assert.equal(cells.length, 80);
  for (const cell of cells) {
    const expected = OPERATIONS.resultCells[cell.kit]
      .find(([candidateCell, role]) => candidateCell === cell.cell && role === cell.role);
    assert.ok(expected, `${cell.kit}/${cell.cell}/${cell.role}: frozen result missing`);
    assert.equal(cell.rgbaSha256, expected[2], `${cell.kit}/${cell.cell}/${cell.role}: result drift`);
  }
});

test("decoded V3 scenery cells equal the independent expected bytes exactly", {
  skip: OPERATIONS_SKIP,
}, async () => {
  const [expectedCells, masters] = await Promise.all([
    independentExpectedCells(),
    decodedSceneryMasters(),
  ]);
  for (const expected of expectedCells) {
    const actual = cropRaw(
      masters[expected.kit],
      [(expected.cell % 16) * 32, Math.floor(expected.cell / 16) * 32, 32, 32],
      `${expected.kit}/${expected.cell}/${expected.role} master cell`,
    );
    assert.deepEqual(actual.data, expected.raw.data,
      `${expected.kit}/${expected.cell}/${expected.role}: V3 cell bytes drift`);
    assert.equal(sha256(actual.data), expected.rgbaSha256);
  }
});

test("receipt discloses exact source hashes, operations, and final hashes for all eighty cells", {
  skip: OPERATIONS_SKIP,
}, async () => {
  const expectedCells = await independentExpectedCells();
  const cellReceipts = new Map(probe.result.receipt.cells
    .filter(({ family }) => family === "scenery")
    .map((entry) => [`${entry.atlasId}:${entry.cell}`, entry]));
  const placementReceipts = new Map(probe.result.receipt.supportPlacements
    .map((entry) => [`${entry.kit}:${entry.cell}:${entry.role}`, entry]));
  assert.equal(cellReceipts.size, 80);
  assert.equal(placementReceipts.size, 80);

  for (const expected of expectedCells) {
    const receipt = cellReceipts.get(`${expected.kit}-scenery:${expected.cell}`);
    assert.ok(receipt, `${expected.kit}/${expected.cell}/${expected.role}: cell receipt missing`);
    const expectedOperations = expected.sourceIds.map((sourceId) => (
      expectedOperation(expected.kit, expected.role, sourceId)
    ));
    assert.deepEqual(receipt.sourceOperations, expectedOperations,
      `${expected.kit}/${expected.cell}/${expected.role}: operation ledger drift`);
    assert.equal(receipt.sourceRgbaSha256, canonicalDigest(expected.sourceIds.map((sourceId) => [
      sourceId,
      OPERATIONS.sourceRgbaSha256[sourceId],
    ])));
    assert.equal(receipt.afterRgbaSha256, expected.rgbaSha256);

    const placement = placementReceipts.get(
      `${expected.kit}:${expected.cell}:${expected.role}`,
    );
    assert.ok(placement, `${expected.kit}/${expected.cell}/${expected.role}: placement receipt missing`);
    assert.equal(placement.resultRgbaSha256, expected.rgbaSha256);
  }
});

