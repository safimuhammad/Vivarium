/**
 * RED-only behavioral contract for the R5 V4 scene-first visual correction.
 *
 * The sole ungated failure is the missing public V4 builder. All later tests
 * decode the real public master/static/dynamic results; no V4 result pixel hash
 * is accepted as authority until a separately trusted visual witness is frozen.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";

import sharp from "sharp";

import {
  REGIONAL_R5_MECHANICS_BINDINGS,
  REGIONAL_R5_PALETTES,
} from "./regional-art-r5-authoring-spec.mjs";
import {
  REGIONAL_R5_V3_ATOMIC_LITERAL_AUTHORITY,
} from "./fixtures/regional-art-r5-v3-atomic-literal-authority.mjs";
import {
  REGIONAL_R5_V3_PORTS_LITERAL_AUTHORITY,
} from "./fixtures/regional-art-r5-v3-ports-literal-authority.mjs";
import {
  REGIONAL_R5_V4_SCENE_FIRST_INTAKE_CLOSURE_AUTHORITY,
  REGIONAL_R5_V4_SCENE_FIRST_LITERAL_AUTHORITY,
  REGIONAL_R5_V4_SCENE_FIRST_LITERAL_AUTHORITY_SHA256,
} from "./fixtures/regional-art-r5-v4-scene-first-literal-authority.mjs";
import * as productionPacker from "./pack-2d-production-assets.mjs";

const AUTHORITY = REGIONAL_R5_V4_SCENE_FIRST_LITERAL_AUTHORITY;
const INTAKE_CLOSURE = REGIONAL_R5_V4_SCENE_FIRST_INTAKE_CLOSURE_AUTHORITY;
const V3_AUTHORITY = REGIONAL_R5_V3_ATOMIC_LITERAL_AUTHORITY;
const PORTS = REGIONAL_R5_V3_PORTS_LITERAL_AUTHORITY;
const API = AUTHORITY.productionApi;
const API_READY = typeof productionPacker[API] === "function";
const API_SKIP = API_READY ? false : `V4_SCENE_FIRST_RED/API_MISSING: ${API}`;
const KITS = Object.freeze([...AUTHORITY.masterBoundary.kits]);
const MASTER_NAMES = Object.freeze([...AUTHORITY.masterBoundary.names]);
const SCENE = Object.freeze({ width: 768, height: 512, channels: 4 });
const NATIVE_SOURCE_ROOT = new URL(
  "../../scratchpad/2d-production-art/source/native/",
  import.meta.url,
);
const DIRECTIONS = Object.freeze({
  n: Object.freeze([0, -1]),
  e: Object.freeze([1, 0]),
  s: Object.freeze([0, 1]),
  w: Object.freeze([-1, 0]),
});
const DIRECTION_NAMES = Object.freeze(Object.keys(DIRECTIONS));
const HUMAN = REGIONAL_R5_MECHANICS_BINDINGS.productionHuman;
const SHADOW = REGIONAL_R5_MECHANICS_BINDINGS.entranceDepth.contactShadow;
const HOME_CONSTRUCTION = REGIONAL_R5_MECHANICS_BINDINGS.visualProofBindings
  .homeActorProofs.construction;
const TEST_LANDMARK_LIMITS = Object.freeze({
  alphaCoverageWithinBoundsMax: 0.88,
  colorsMin: 4,
  connectedSilhouetteShareMin: 0.55,
  differingEdgeDensityMax: 0.45,
  differingEdgeDensityMin: 0.02,
  dominantShareMax: 0.75,
  groundContactPixelsMin: 8,
  horizontalEdgeShareMin: 0.15,
  significantColorsMin: 3,
  significantShareMin: 0.02,
  silhouetteHeightMin: 48,
  silhouetteWidthMin: 64,
  tinyComponentShareMax: 0.08,
  transparentNegativeSpaceMin: 0.02,
  verticalEdgeShareMin: 0.15,
});
const TEST_TERRAIN_LIMITS = Object.freeze({
  cellPixels: 32,
  maximumShiftTiles: 8,
  phaseLockedEnergyMax: 0.1,
  residualAutocorrelationMax: 0.28,
});
const TEST_CLUSTER_LIMITS = Object.freeze({
  dominantMassShareMin: 0.5,
  isolatedSupportPixelShareMax: 0.15,
  maximumDilatedComponents: 2,
  negativeWalkableShareMin: 0.3,
  omitOneVisibleShareMin: 0.75,
  supportCoverageMax: 0.15,
  supportHeightMin: 6,
  supportPixelsMin: 48,
  supportWidthMin: 6,
});

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function hexRgb(value) {
  assert.match(value, /^#[a-f0-9]{6}$/iu);
  return [1, 3, 5].map((start) => Number.parseInt(value.slice(start, start + 2), 16));
}

function copyRaw(raw) {
  return { data: Buffer.from(raw.data), width: raw.width, height: raw.height, channels: 4 };
}

function emptyRaw(width = SCENE.width, height = SCENE.height) {
  return { data: Buffer.alloc(width * height * 4), width, height, channels: 4 };
}

function assertExactKeys(value, expected, label) {
  assert.deepEqual(Reflect.ownKeys(value).sort(compareText), [...expected].sort(compareText),
    `${label}: open or missing fields`);
}

function structuredCloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneAcceptedValue(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(cloneAcceptedValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      cloneAcceptedValue(child),
    ]));
  }
  return value;
}

function transferableBuffer(bytes) {
  const backing = new ArrayBuffer(bytes.length);
  const buffer = Buffer.from(backing);
  bytes.copy(buffer);
  return { backing, buffer };
}

async function assertExactResolution(operation, expected, label) {
  const actual = await operation;
  assert.equal(
    isDeepStrictEqual(actual, expected),
    true,
    `${label}: must resolve from the synchronous detached snapshot`,
  );
}

async function recordContractCase(failures, label, operation) {
  try {
    await operation();
  } catch (error) {
    const code = typeof error?.code === "string" ? `/${error.code}` : "";
    failures.push(`${label}: ${error?.name ?? "Error"}${code}: ${error?.message ?? String(error)}`);
  }
}

function assertNoContractFailures(failures, label) {
  assert.equal(failures.length, 0, `${label}:\n${failures.join("\n")}`);
}

function humanRecord(kit, index, role, x, y, replaces, squaredDistance, manhattanDistance) {
  return {
    id: `r5-v4-dynamic/${kit}/human/${index}`,
    role,
    destination: { x, y, width: 48, height: 64 },
    relocation: {
      replaces,
      selection: "nearest-legal-full-body-and-shadow",
      squaredDistance,
      manhattanDistance,
    },
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object" && !Buffer.isBuffer(value)) {
    return `{${Object.keys(value).sort(compareText).map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalDigest(value) {
  return sha256(Buffer.from(canonicalJson(value)));
}

function withoutDigest(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "canonicalSha256"));
}

function assertDeeplyFrozen(value, label) {
  assert.equal(Object.isFrozen(value), true, `${label}: must be frozen`);
  if (value === null || typeof value !== "object" || Buffer.isBuffer(value)) return;
  for (const key of Reflect.ownKeys(value)) {
    const child = value[key];
    if (child !== null && typeof child === "object") {
      assertDeeplyFrozen(child, `${label}.${String(key)}`);
    }
  }
}

function geometryFor(atlasId) {
  const family = AUTHORITY.masterBoundary.families
    .find((candidate) => atlasId.endsWith(`-${candidate}`));
  assert.ok(family, `${atlasId}: unknown V4 master family`);
  return AUTHORITY.masterBoundary.geometryByFamily[family];
}

async function decodePng(bytes, geometry, label) {
  assert.ok(Buffer.isBuffer(bytes), `${label}: encoded PNG must be a Buffer`);
  const { data, info } = await sharp(bytes).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepEqual(
    [info.width, info.height, info.channels],
    [geometry.width, geometry.height, geometry.channels],
    `${label}: decoded geometry drift`,
  );
  return { data, width: info.width, height: info.height, channels: info.channels };
}

async function decodeMasters(masterBuffers) {
  assert.deepEqual(Reflect.ownKeys(masterBuffers).sort(compareText), MASTER_NAMES);
  return Object.fromEntries(await Promise.all(MASTER_NAMES.map(async (atlasId) => [
    atlasId,
    await decodePng(masterBuffers[atlasId], geometryFor(atlasId), atlasId),
  ])));
}

function rawCell(master, atlasId, cell) {
  const geometry = geometryFor(atlasId);
  assert.ok(Number.isSafeInteger(cell) && cell >= 0
    && cell < geometry.columns * geometry.rows, `${atlasId}/${cell}: cell out of range`);
  const left = cell % geometry.columns * geometry.cellWidth;
  const top = Math.floor(cell / geometry.columns) * geometry.cellHeight;
  const data = Buffer.alloc(geometry.cellWidth * geometry.cellHeight * 4);
  for (let row = 0; row < geometry.cellHeight; row += 1) {
    const sourceStart = ((top + row) * master.width + left) * 4;
    master.data.copy(data, row * geometry.cellWidth * 4, sourceStart,
      sourceStart + geometry.cellWidth * 4);
  }
  return {
    data,
    width: geometry.cellWidth,
    height: geometry.cellHeight,
    channels: 4,
  };
}

function rgbaAt(raw, x, y) {
  const offset = (y * raw.width + x) * 4;
  return [...raw.data.subarray(offset, offset + 4)];
}

function placeOpaque(destination, source, destinationX, destinationY) {
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const sourceOffset = (y * source.width + x) * 4;
      const alpha = source.data[sourceOffset + 3];
      assert.ok(alpha === 0 || alpha === 255, "V4 presentation sources require binary alpha");
      if (alpha === 0) continue;
      const sceneX = destinationX + x;
      const sceneY = destinationY + y;
      if (sceneX < 0 || sceneY < 0
          || sceneX >= destination.width || sceneY >= destination.height) continue;
      source.data.copy(destination.data, (sceneY * destination.width + sceneX) * 4,
        sourceOffset, sourceOffset + 4);
    }
  }
}

function cropRaw(source, x, y, width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * source.width + x) * 4;
    source.data.copy(data, row * width * 4, sourceStart, sourceStart + width * 4);
  }
  return { data, width, height, channels: 4 };
}

function sourceCell(source, cell, cellWidth, cellHeight) {
  const columns = source.width / cellWidth;
  return cropRaw(
    source,
    cell % columns * cellWidth,
    Math.floor(cell / columns) * cellHeight,
    cellWidth,
    cellHeight,
  );
}

function sourceRectFor(atlasId, cell) {
  const geometry = geometryFor(atlasId);
  return {
    x: cell % geometry.columns * geometry.cellWidth,
    y: Math.floor(cell / geometry.columns) * geometry.cellHeight,
    width: geometry.cellWidth,
    height: geometry.cellHeight,
  };
}

function opaquePixels(raw) {
  let count = 0;
  for (let offset = 3; offset < raw.data.length; offset += 4) count += raw.data[offset] === 255;
  return count;
}

function assertCanonicalTransparency(raw, label) {
  for (let offset = 0; offset < raw.data.length; offset += 4) {
    const alpha = raw.data[offset + 3];
    assert.ok(alpha === 0 || alpha === 255, `${label}: alpha must be binary at pixel ${offset / 4}`);
    if (alpha === 0) assert.deepEqual([...raw.data.subarray(offset, offset + 3)], [0, 0, 0],
      `${label}: transparent RGB must be zero at pixel ${offset / 4}`);
  }
}

function independentStaticScene(kit, placements, decoded, masterBuffers) {
  const output = emptyRaw();
  const visibleStaticLayers = [];
  assert.equal(placements.visibleStaticLayers.length, AUTHORITY.preservation.staticLayersPerScene);
  for (const layer of placements.visibleStaticLayers) {
    const cell = rawCell(decoded[layer.atlasId], layer.atlasId, layer.cell);
    placeOpaque(output, cell, layer.destination.x, layer.destination.y);
    const sourceRect = sourceRectFor(layer.atlasId, layer.cell);
    visibleStaticLayers.push({
      id: layer.id,
      role: layer.role,
      destination: { ...layer.destination, width: cell.width, height: cell.height },
      contributedOpaquePixels: opaquePixels(cell),
      provenance: {
        atlasId: layer.atlasId,
        cell: {
          column: sourceRect.x / sourceRect.width,
          index: layer.cell,
          row: sourceRect.y / sourceRect.height,
        },
        masterPngSha256: sha256(masterBuffers[layer.atlasId]),
        sourceRect,
        sourceRgbaSha256: sha256(cell.data),
      },
    });
  }
  return { raw: output, visibleStaticLayers };
}

function setPixel(raw, x, y, rgba) {
  assert.ok(Number.isSafeInteger(x) && Number.isSafeInteger(y), "repair coordinates must be integers");
  if (x < 0 || y < 0 || x >= raw.width || y >= raw.height) return;
  raw.data.set(rgba, (y * raw.width + x) * 4);
}

function paletteRgba(kit, token) {
  const value = token === "outline" ? REGIONAL_R5_PALETTES.outline.source
    : REGIONAL_R5_PALETTES.kits[kit]?.[token] ?? REGIONAL_R5_PALETTES.shared[token];
  assert.ok(value, `${kit}/${token}: palette token is not authoritative`);
  return [...hexRgb(value), 255];
}

function validateRect(rect, raw, label) {
  assert.ok(Array.isArray(rect) && rect.length === 4 && rect.every(Number.isSafeInteger),
    `${label}: geometry must be four integers`);
  const [x, y, width, height] = rect;
  assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0
    && x + width <= raw.width && y + height <= raw.height, `${label}: geometry escapes target cell`);
}

function replayRepairProgram(kit, record, predecessorCell) {
  const authority = AUTHORITY.repairProgram;
  assert.equal(record.programSchema, authority.schema);
  assert.ok(record.orderedOperations.length <= authority.maximumOrderedOperationsByFamily[record.family]);
  assert.equal(record.orderedOperations[0]?.kind, authority.firstOperation);
  assert.equal(record.sourceOperations.length, 1,
    `${record.atlasId}/${record.cell}: exactly one immutable predecessor source is permitted`);
  const source = record.sourceOperations[0];
  assertExactKeys(source, authority.sourceOperationFields, "repair source operation");
  assert.equal(source.sourceId, `v3-master/${record.atlasId}/${record.cell}`);
  assert.equal(source.encodedMasterPngSha256,
    authority === AUTHORITY.repairProgram
      ? AUTHORITY.predecessor.masterPngSha256[record.atlasId] : null);
  assert.equal(source.sourceRgbaSha256, sha256(predecessorCell.data));
  const expectedRect = sourceRectFor(record.atlasId, record.cell);
  assert.deepEqual(source.cropRect,
    [expectedRect.x, expectedRect.y, expectedRect.width, expectedRect.height]);
  assert.deepEqual(source.destination, authority.exactDestination);

  const output = emptyRaw(predecessorCell.width, predecessorCell.height);
  const square = (x, y, width, height, rgba) => {
    for (let row = y; row < y + height; row += 1) {
      for (let column = x; column < x + width; column += 1) setPixel(output, column, row, rgba);
    }
  };
  for (const [index, operation] of record.orderedOperations.entries()) {
    const fields = authority.orderedOperationFieldsByKind[operation.kind];
    assert.ok(fields, `${record.atlasId}/${record.cell}/${index}: forbidden repair operation`);
    assertExactKeys(operation, fields, `repair operation ${index}`);
    if (operation.kind === "alpha-over-source") {
      assert.equal(operation.sourceIndex, 0);
      placeOpaque(output, predecessorCell, 0, 0);
      continue;
    }
    if (operation.kind === "clear-rect") {
      validateRect(operation.rect, output, `clear-rect/${index}`);
      square(...operation.rect, [0, 0, 0, 0]);
      continue;
    }
    const rgba = paletteRgba(kit, operation.paletteToken);
    if (operation.kind === "fill-rect") {
      validateRect(operation.rect, output, `fill-rect/${index}`);
      square(...operation.rect, rgba);
    } else if (operation.kind === "fill-ellipse") {
      validateRect(operation.bounds, output, `fill-ellipse/${index}`);
      const [x, y, width, height] = operation.bounds;
      for (let row = y; row < y + height; row += 1) for (let column = x; column < x + width; column += 1) {
        const dx = (column + 0.5 - (x + width / 2)) / (width / 2);
        const dy = (row + 0.5 - (y + height / 2)) / (height / 2);
        if (dx * dx + dy * dy <= 1) setPixel(output, column, row, rgba);
      }
    } else if (operation.kind === "fill-horizontal-run") {
      validateRect([operation.x, operation.y, operation.length, operation.thickness], output,
        `horizontal-run/${index}`);
      square(operation.x, operation.y, operation.length, operation.thickness, rgba);
    } else if (operation.kind === "fill-vertical-run") {
      validateRect([operation.x, operation.y, operation.thickness, operation.length], output,
        `vertical-run/${index}`);
      square(operation.x, operation.y, operation.thickness, operation.length, rgba);
    } else {
      assert.ok(operation.points.length >= 2 && operation.points.every((point) => (
        Array.isArray(point) && point.length === 2 && point.every(Number.isSafeInteger)
      )), `stroke-polyline/${index}: points invalid`);
      assert.ok(Number.isSafeInteger(operation.thickness) && operation.thickness >= 1
        && operation.thickness <= 8, `stroke-polyline/${index}: thickness invalid`);
      for (let segment = 1; segment < operation.points.length; segment += 1) {
        let [x0, y0] = operation.points[segment - 1];
        const [x1, y1] = operation.points[segment];
        const dx = Math.abs(x1 - x0);
        const sx = x0 < x1 ? 1 : -1;
        const dy = -Math.abs(y1 - y0);
        const sy = y0 < y1 ? 1 : -1;
        let error = dx + dy;
        for (;;) {
          square(x0 - Math.floor(operation.thickness / 2),
            y0 - Math.floor(operation.thickness / 2), operation.thickness, operation.thickness, rgba);
          if (x0 === x1 && y0 === y1) break;
          const doubled = 2 * error;
          if (doubled >= dy) { error += dy; x0 += sx; }
          if (doubled <= dx) { error += dx; y0 += sy; }
        }
      }
    }
  }
  assertCanonicalTransparency(output, `${record.atlasId}/${record.cell}/replayed`);
  return output;
}

function pixelDifferenceCount(left, right) {
  assert.deepEqual([left.width, left.height], [right.width, right.height]);
  let count = 0;
  for (let offset = 0; offset < left.data.length; offset += 4) {
    if (!left.data.subarray(offset, offset + 4).equals(right.data.subarray(offset, offset + 4))) count += 1;
  }
  return count;
}

function hostileInput(base, representation, name) {
  const input = { ...base };
  if (representation === "enumerable") input[name] = Buffer.alloc(4);
  else if (representation === "non-enumerable") {
    Object.defineProperty(input, name, {
      configurable: true,
      enumerable: false,
      value: Buffer.alloc(4),
    });
  } else input[Symbol(name)] = Buffer.alloc(4);
  return input;
}

function pointerSegment(key) {
  return String(key).replaceAll("~", "~0").replaceAll("/", "~1");
}

function acceptedContainerInventory(root) {
  const records = [];
  const seen = new Set();
  const visit = (value, steps, path) => {
    if (value === null || typeof value !== "object") return;
    assert.equal(seen.has(value), false, `${path}: accepted input must not contain aliases or cycles`);
    seen.add(value);
    const kind = Buffer.isBuffer(value) ? "Buffer" : Array.isArray(value) ? "Array" : "Object";
    records.push({ kind, path, steps });
    if (kind === "Buffer") return;
    for (const key of Reflect.ownKeys(value)) {
      assert.equal(typeof key, "string", `${path}: clean accepted input contains a Symbol`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      assert.ok(descriptor && "value" in descriptor,
        `${path}/${pointerSegment(key)}: clean accepted input contains an accessor`);
      visit(descriptor.value, [...steps, key], `${path}/${pointerSegment(key)}`);
    }
  };
  visit(root, [], "<root>");
  records.sort((left, right) => compareText(left.path, right.path)
    || compareText(left.kind, right.kind));
  return records;
}

function publicInventoryRows(records) {
  return records.map(({ kind, path }) => ({ path, kind }));
}

function assertPinnedContainerInventory(surface, input) {
  const records = acceptedContainerInventory(input);
  const expected = INTAKE_CLOSURE.surfaces[surface];
  const paths = records.map(({ path }) => path);
  assert.equal(new Set(paths).size, paths.length, `${surface}: container paths must be unique`);
  assert.equal(records[0]?.path, "<root>", `${surface}: root container is missing`);
  const kindCounts = { Array: 0, Buffer: 0, Object: 0 };
  for (const { kind } of records) kindCounts[kind] += 1;
  assert.equal(records.length, expected.pathCount, `${surface}: accepted-container path count drift`);
  assert.deepEqual(kindCounts, expected.kindCounts, `${surface}: accepted-container kind counts drift`);
  assert.equal(
    sha256(Buffer.from(JSON.stringify(publicInventoryRows(records)))),
    expected.pathSha256,
    `${surface}: accepted-container path inventory drift`,
  );
  return records;
}

function emptyClosureProbeContainer(kind, label) {
  if (kind === "Object") return {};
  if (kind === "Array") return [];
  if (kind === "Buffer") return Buffer.alloc(0);
  throw new Error(`${label}: unsupported accepted-container kind ${kind}`);
}

const closureInventoryIndexes = new WeakMap();

function closureProbeSpine(records, targetRecord) {
  let recordsByPath = closureInventoryIndexes.get(records);
  if (!recordsByPath) {
    recordsByPath = new Map(records.map((record) => [record.path, record]));
    assert.equal(recordsByPath.size, records.length,
      `${targetRecord.path}: closure inventory paths must be unique`);
    closureInventoryIndexes.set(records, recordsByPath);
  }
  const pinnedTarget = recordsByPath.get(targetRecord.path);
  assert.ok(pinnedTarget, `${targetRecord.path}: target is absent from the pinned inventory`);
  assert.deepEqual(
    { kind: pinnedTarget.kind, steps: pinnedTarget.steps },
    { kind: targetRecord.kind, steps: targetRecord.steps },
    `${targetRecord.path}: target record drifted from the pinned inventory`,
  );

  const chain = [];
  let path = "<root>";
  let root;
  let parent;
  for (let depth = 0; depth <= targetRecord.steps.length; depth += 1) {
    if (depth > 0) path += `/${pointerSegment(targetRecord.steps[depth - 1])}`;
    const record = recordsByPath.get(path);
    assert.ok(record, `${targetRecord.path}: missing accepted spine record ${path}`);
    assert.deepEqual(record.steps, targetRecord.steps.slice(0, depth),
      `${targetRecord.path}: accepted spine steps drifted at ${path}`);
    const container = emptyClosureProbeContainer(record.kind, path);
    if (depth === 0) root = container;
    else {
      Object.defineProperty(parent, targetRecord.steps[depth - 1], {
        configurable: true,
        enumerable: true,
        value: container,
        writable: true,
      });
    }
    parent = container;
    chain.push({ kind: record.kind, path: record.path, steps: [...record.steps] });
  }

  let dataLeafKey = null;
  if (targetRecord.kind !== "Buffer") {
    dataLeafKey = targetRecord.kind === "Array" ? "0" : "__v4_probe_data";
    Object.defineProperty(parent, dataLeafKey, {
      configurable: true,
      enumerable: true,
      value: null,
      writable: true,
    });
  }
  return { chain, dataLeafKey, root, target: parent };
}

test("closureProbeSpine reconstructs exact accepted container paths and kinds", () => {
  const accepted = {
    branch: [{ leaf: { bytes: Buffer.from([1, 2, 3]) } }],
  };
  const records = acceptedContainerInventory(accepted);
  for (const record of records) {
    const probe = closureProbeSpine(records, record);
    const expectedChain = records
      .filter((candidate) => candidate.steps.every((step, index) => (
        record.steps[index] === step
      )) && candidate.steps.length <= record.steps.length)
      .sort((left, right) => left.steps.length - right.steps.length)
      .map(({ kind, path, steps }) => ({ kind, path, steps }));
    assert.deepEqual(probe.chain, expectedChain,
      `${record.path}: spine must preserve every root-to-target kind and step`);
    assert.doesNotThrow(() => productionPacker.snapshotRegionalR5CompositionInput(probe.root),
      `${record.path}: unattacked spine must pass the exported shared intake`);
    if (record.kind === "Buffer") {
      assert.equal(probe.target.length, 0,
        `${record.path}: Buffer probe targets must not copy accepted pixel bytes`);
      assert.equal(probe.dataLeafKey, null);
    } else {
      const descriptor = Object.getOwnPropertyDescriptor(probe.target, probe.dataLeafKey);
      assert.ok(descriptor && "value" in descriptor,
        `${record.path}: non-Buffer probe target requires a data leaf`);
      assert.equal(descriptor.configurable, true,
        `${record.path}: probe data leaf must support accessor attacks`);
      assert.equal(descriptor.enumerable, true,
        `${record.path}: unattacked probe data leaf must remain valid intake`);
    }
  }
});

test("closure probe attacks are rejected by exported intake at their exact target", () => {
  const accepted = {
    branch: [{ leaf: { bytes: Buffer.from([1, 2, 3]) } }],
  };
  const records = acceptedContainerInventory(accepted);
  const cases = [
    ["<root>/branch", "symbol"],
    ["<root>/branch", "non-enumerable"],
    ["<root>/branch/0/leaf", "accepted-field-accessor"],
    ["<root>/branch/0/leaf", "custom-prototype"],
    ["<root>/branch/0/leaf", "non-enumerable"],
    ["<root>/branch/0/leaf/bytes", "symbol"],
  ];
  for (const [path, representation] of cases) {
    const record = records.find((candidate) => candidate.path === path);
    assert.ok(record, `${path}: synthetic accepted target missing`);
    const probe = closureProbeSpine(records, record);
    const label = `micro-contract/${path}/${representation}`;
    const attack = installContainerAttack(probe.root, record, representation, label);
    try {
      assert.ok(Array.isArray(attack.expectedIntakePath),
        `${label}: attack must expose its exact expected intake path`);
      assertSharedIntakeRejectsAtPath(probe.root, attack.expectedIntakePath, label);
    } finally {
      attack.restore();
    }
    assert.equal(attack.accessorReads(), 0,
      `${label}: direct intake proof must not execute getters`);
  }
});

function containerAtSteps(root, steps) {
  let value = root;
  for (const key of steps) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert.ok(descriptor && "value" in descriptor,
      `${steps.map(pointerSegment).join("/")}: expected a data-property path`);
    value = descriptor.value;
  }
  return value;
}

function installContainerAttack(root, record, representation, label) {
  const target = containerAtSteps(root, record.steps);
  assert.ok(target !== null && typeof target === "object", `${label}: target must be a container`);
  const metadataKey = `__v4_intake_${sha256(Buffer.from(label)).slice(0, 16)}`;
  const targetPath = [...record.steps];
  let accessorReads = 0;
  if (representation === "non-enumerable") {
    Object.defineProperty(target, metadataKey, {
      configurable: true,
      enumerable: false,
      value: "not-authority",
    });
    return {
      accessorReads: () => accessorReads,
      expectedIntakePath: record.kind === "Object"
        ? [...targetPath, metadataKey] : targetPath,
      restore: () => Reflect.deleteProperty(target, metadataKey),
    };
  }
  if (representation === "symbol") {
    const symbol = Symbol(metadataKey);
    target[symbol] = "not-authority";
    return {
      accessorReads: () => accessorReads,
      expectedIntakePath: targetPath,
      restore: () => Reflect.deleteProperty(target, symbol),
    };
  }
  if (representation === "accepted-field-accessor") {
    const acceptedKey = Reflect.ownKeys(target).find((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      return typeof key === "string" && descriptor && "value" in descriptor
        && descriptor.configurable === true;
    });
    assert.notEqual(acceptedKey, undefined,
      `${label}: accepted-field accessor requires a configurable accepted field`);
    const descriptor = Object.getOwnPropertyDescriptor(target, acceptedKey);
    Object.defineProperty(target, acceptedKey, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        accessorReads += 1;
        return descriptor.value;
      },
    });
    return {
      accessorReads: () => accessorReads,
      expectedIntakePath: [...targetPath, acceptedKey],
      restore: () => Object.defineProperty(target, acceptedKey, descriptor),
    };
  }
  if (representation === "custom-prototype") {
    const originalPrototype = Object.getPrototypeOf(target);
    const hostilePrototype = Object.create(originalPrototype);
    Object.defineProperty(hostilePrototype, "__v4_inherited_metadata", {
      configurable: true,
      enumerable: true,
      value: "not-authority",
    });
    Object.setPrototypeOf(target, hostilePrototype);
    return {
      accessorReads: () => accessorReads,
      expectedIntakePath: targetPath,
      restore: () => Object.setPrototypeOf(target, originalPrototype),
    };
  }
  throw new Error(`${label}: unknown closure representation ${representation}`);
}

function assertSharedIntakeRejectsAtPath(input, expectedPath, label) {
  assert.throws(
    () => productionPacker.snapshotRegionalR5CompositionInput(input),
    (error) => {
      assert.equal(error instanceof Error, true, `${label}: intake rejection must be an Error`);
      assert.equal(error.constructor, TypeError, `${label}: exact intake TypeError required`);
      assert.equal(error.name, "TypeError", `${label}: exact intake TypeError name required`);
      assert.deepEqual(error.intakePath, expectedPath,
        `${label}: shared intake must reject at the attacked target path`);
      return true;
    },
    `${label}: exported shared intake must reject synchronously`,
  );
}

function deterministicRepresentation(record, index) {
  const order = INTAKE_CLOSURE.representationOrder;
  const selected = order[index % order.length];
  if (record.kind === "Buffer" && selected === "accepted-field-accessor") return "symbol";
  return selected;
}

function statefulTrapProxy(value) {
  const traps = {
    get: 0,
    getOwnPropertyDescriptor: 0,
    getPrototypeOf: 0,
    has: 0,
    isExtensible: 0,
    ownKeys: 0,
  };
  const proxy = new Proxy(value, {
    get(target, key, receiver) {
      traps.get += 1;
      return Reflect.get(target, key, receiver);
    },
    getOwnPropertyDescriptor(target, key) {
      traps.getOwnPropertyDescriptor += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    getPrototypeOf(target) {
      traps.getPrototypeOf += 1;
      return Reflect.getPrototypeOf(target);
    },
    has(target, key) {
      traps.has += 1;
      return Reflect.has(target, key);
    },
    isExtensible(target) {
      traps.isExtensible += 1;
      return Reflect.isExtensible(target);
    },
    ownKeys(target) {
      traps.ownKeys += 1;
      const keys = Reflect.ownKeys(target);
      return traps.ownKeys === 1 ? keys : [...keys, `__v4_late_proxy_key_${traps.ownKeys}`];
    },
  });
  return { proxy, trapReads: () => ({ ...traps }) };
}

function replaceNestedContainerWithProxy(root, steps) {
  assert.ok(steps.length > 0, "stateful Proxy proof requires a nested container path");
  const parent = containerAtSteps(root, steps.slice(0, -1));
  const key = steps.at(-1);
  const descriptor = Object.getOwnPropertyDescriptor(parent, key);
  assert.ok(descriptor && "value" in descriptor, "nested Proxy target must be a data property");
  const stateful = statefulTrapProxy(descriptor.value);
  Object.defineProperty(parent, key, { ...descriptor, value: stateful.proxy });
  return {
    restore: () => Object.defineProperty(parent, key, descriptor),
    trapReads: stateful.trapReads,
  };
}

async function assertMappedAsyncBoundaryRejects(operation, expectedCode, label) {
  assert.equal(operation instanceof Promise, true,
    `${label}: async public boundary must return a Promise`);
  await assert.rejects(operation, (error) => {
    assert.equal(error instanceof Error, true, `${label}: rejection must be an Error`);
    assert.equal(error.code, expectedCode, `${label}: public boundary error mapping drift`);
    return true;
  }, label);
}

function mappedBoundaryCode(surface, steps) {
  const root = steps[0];
  if (surface === "staticCompositor") {
    if (root === "masterBuffers") return "MASTER_INVENTORY_INVALID";
    if (root === "placements") return "PLACEMENT_AUTHORITY_INVALID";
    if (root === "authoringIdentity") return "V3_AUTHORING_IDENTITY_MISMATCH";
    return "CALLER_SOURCE_FORBIDDEN";
  }
  if (surface === "dynamicCompositor") {
    if (root === "staticScenes") return "STATIC_SCENE_INVALID";
    if (root === "dynamicSourceBuffers") return "DYNAMIC_SOURCE_INVENTORY_INVALID";
    if (root === "placements") return "PLACEMENT_AUTHORITY_INVALID";
    return "CALLER_SOURCE_FORBIDDEN";
  }
  throw new Error(`${surface}: async boundary error mapping is undefined`);
}

function assertSynchronousTypeError(operation, label) {
  assert.throws(
    operation,
    (error) => error instanceof Error
      && error.constructor === TypeError && error.name === "TypeError",
    `${label}: exact synchronous TypeError required`,
  );
}

function targetCellMap() {
  const targets = new Map();
  for (const kit of KITS) {
    for (const cell of AUTHORITY.preservation.changedTerrainCellsPerKit) {
      targets.set(`${kit}-terrain/${cell}`, {
        atlasId: `${kit}-terrain`, cell, family: "terrain", role: `quiet-terrain-${cell}`,
      });
    }
    for (const [family, records] of [
      ["landmarks", AUTHORITY.repairInventory[kit].landmarks],
      ["scenery", AUTHORITY.repairInventory[kit].supports],
    ]) {
      for (const record of records) {
        targets.set(`${kit}-${family}/${record.cell}`, {
          atlasId: `${kit}-${family}`,
          cell: record.cell,
          family,
          role: record.role,
        });
      }
    }
  }
  return targets;
}

function parseRoute(path) {
  return path.split(" ").map((pair) => pair.split(",").map(Number));
}

function tileKey([x, y]) {
  return `${x},${y}`;
}

function directionFor(dx, dy) {
  return Object.entries(DIRECTIONS)
    .find(([_direction, [candidateX, candidateY]]) => candidateX === dx
      && candidateY === dy)?.[0];
}

function edgeCoordinates(direction, size) {
  return Array.from({ length: size }, (_unused, offset) => {
    if (direction === "n") return [offset, 0];
    if (direction === "e") return [size - 1, offset];
    if (direction === "s") return [offset, size - 1];
    return [0, offset];
  });
}

function contiguousSpans(mask) {
  const spans = [];
  let start = null;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] && start === null) start = index;
    if (start !== null && (!mask[index] || index === mask.length - 1)) {
      spans.push([start, mask[index] ? index : index - 1]);
      start = null;
    }
  }
  return spans;
}

function alphaEdgeSpans(raw, direction) {
  return contiguousSpans(edgeCoordinates(direction, raw.width)
    .map(([x, y]) => rgbaAt(raw, x, y)[3] !== 0));
}

function colorEdgeHasPort(raw, direction, groundRgb) {
  return edgeCoordinates(direction, raw.width).some(([x, y]) => (
    canonicalJson(rgbaAt(raw, x, y).slice(0, 3)) !== canonicalJson(groundRgb)
  ));
}

let v3BuildPromise;
function v3Build() {
  v3BuildPromise ??= productionPacker[AUTHORITY.publicApis.predecessorBuilder]({
    authority: V3_AUTHORITY,
  });
  return v3BuildPromise;
}

function describeBuildResult(result) {
  return {
    schema: result.schema,
    authority: result.authority,
    masterPngSha256: Object.fromEntries(MASTER_NAMES.map((name) => [name, sha256(result.masterBuffers[name])])),
    placements: result.placements,
    authoringIdentity: result.authoringIdentity,
    receipt: result.receipt,
  };
}

function describeStaticScenes(result) {
  return {
    schema: result.schema,
    generation: result.generation,
    published: result.published,
    task6Ready: result.task6Ready,
    trustedV3: result.trustedV3,
    trustedV4: result.trustedV4,
    scenes: Object.fromEntries(KITS.map((kit) => [kit, {
      rgbaSha256: sha256(result.scenes[kit].raw.data),
      visibleStaticLayers: result.scenes[kit].visibleStaticLayers,
      identities: result.scenes[kit].identities,
    }])),
  };
}

function describeDynamicScenes(result) {
  return {
    schema: result.schema,
    staticGeneration: result.staticGeneration,
    published: result.published,
    task6Ready: result.task6Ready,
    scenes: Object.fromEntries(KITS.map((kit) => [kit, {
      rgbaSha256: sha256(result.scenes[kit].raw.data),
      dynamic: result.scenes[kit].dynamic,
    }])),
  };
}

async function completeV3PublicSnapshot() {
  const built = await productionPacker[AUTHORITY.publicApis.predecessorBuilder]({ authority: V3_AUTHORITY });
  const port = productionPacker[AUTHORITY.publicApis.predecessorPortReceipt]();
  const integration = productionPacker[AUTHORITY.publicApis.predecessorIdentity]();
  const staticScenes = await productionPacker[AUTHORITY.publicApis.staticCompositor]({
    masterBuffers: built.masterBuffers,
    placements: built.placements,
    authoringIdentity: built.authoringIdentity,
  });
  const dynamicPlacements = productionPacker.regionalR5DynamicPresentationPlacements();
  const dynamic = await productionPacker[AUTHORITY.publicApis.dynamicCompositor]({
    staticScenes,
    dynamicSourceBuffers: await dynamicSourceBuffers(built.masterBuffers),
    placements: dynamicPlacements,
  });
  return {
    build: describeBuildResult(built),
    port,
    integration,
    staticScenes: describeStaticScenes(staticScenes),
    dynamicPlacements,
    dynamicScenes: describeDynamicScenes(dynamic),
  };
}

let v4BuildPromise;
function v4Build() {
  v4BuildPromise ??= productionPacker[API]({ authority: AUTHORITY });
  return v4BuildPromise;
}

let staticScenesPromise;
function v4StaticScenes() {
  staticScenesPromise ??= (async () => {
    const built = await v4Build();
    return productionPacker[AUTHORITY.publicApis.staticCompositor]({
      masterBuffers: built.masterBuffers,
      placements: built.placements,
      authoringIdentity: built.authoringIdentity,
    });
  })();
  return staticScenesPromise;
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
  ]) buffers[`core-${name}`] = await readFile(new URL(`core/${name}.png`, NATIVE_SOURCE_ROOT));
  return buffers;
}

let dynamicInputPromise;
function v4DynamicInput() {
  dynamicInputPromise ??= (async () => {
    const [built, staticScenes] = await Promise.all([v4Build(), v4StaticScenes()]);
    return {
      staticScenes,
      dynamicSourceBuffers: await dynamicSourceBuffers(built.masterBuffers),
      placements: built.dynamicPlacements,
    };
  })();
  return dynamicInputPromise;
}

let dynamicScenesPromise;
function v4DynamicScenes() {
  dynamicScenesPromise ??= (async () => {
    const input = await v4DynamicInput();
    return productionPacker[AUTHORITY.publicApis.dynamicCompositor](input);
  })();
  return dynamicScenesPromise;
}

async function decodedDynamicSources(buffers) {
  const decoded = {};
  for (const [name, bytes] of Object.entries(buffers)) {
    let geometry;
    if (name.endsWith("-home-yards")) geometry = { width: 960, height: 160, channels: 4 };
    else if (name.endsWith("-home-components")) {
      const kit = KITS.find((candidate) => name === `${candidate}-home-components`);
      const proof = REGIONAL_R5_MECHANICS_BINDINGS.visualProofBindings.homeActorProofs.kitProofs
        .find(({ kitId }) => kitId === kit);
      assert.ok(proof, `${name}: HomeActor proof missing`);
      assert.equal(sha256(bytes), proof.componentAtlasPngSha256,
        `${name}: V4 must preserve exact HomeActor source bytes`);
      geometry = { ...proof.componentAtlasGeometry, channels: 4 };
    } else {
      const layer = HUMAN.layers.find(({ atlasId }) => atlasId === name);
      assert.ok(layer, `${name}: canonical human source missing`);
      assert.equal(sha256(bytes), layer.atlasSha256,
        `${name}: V4 must preserve exact human source bytes`);
      const sourceGeometry = {
        "core-human-body-rigs": [768, 1408],
        "core-human-face-planes": [768, 256],
        "core-human-hair": [768, 768],
        "core-human-clothing-00": [768, 704],
      }[name];
      geometry = { width: sourceGeometry[0], height: sourceGeometry[1], channels: 4 };
    }
    decoded[name] = {
      ...await decodePng(bytes, geometry, name),
      pngSha256: sha256(bytes),
    };
  }
  return decoded;
}

function buildCanonicalHuman(decoded) {
  const raw = { data: Buffer.alloc(48 * 64 * 4), width: 48, height: 64, channels: 4 };
  const layers = [];
  let face;
  for (const layer of HUMAN.layers) {
    const cell = sourceCell(decoded[layer.atlasId], layer.cellIndex, 48, 64);
    const columns = decoded[layer.atlasId].width / 48;
    placeOpaque(raw, cell, 0, 0);
    layers.push({
      atlasId: layer.atlasId,
      pngSha256: layer.atlasSha256,
      cell: layer.cellIndex,
      sourceRect: {
        x: layer.cellIndex % columns * 48,
        y: Math.floor(layer.cellIndex / columns) * 64,
        width: 48,
        height: 64,
      },
      sourceRgbaSha256: sha256(cell.data),
    });
    if (layer.atlasId === "core-human-face-planes") face = cell;
  }
  assert.equal(sha256(raw.data), HUMAN.canonicalPatchSha256);
  return { raw, face, layers };
}

function buildHomeActor(decoded, kit) {
  const atlas = decoded[`${kit}-home-components`];
  const groups = {};
  const sourceLayers = {};
  for (const group of ["back", "front"]) {
    const proof = emptyRaw(HOME_CONSTRUCTION.output.width, HOME_CONSTRUCTION.output.height);
    sourceLayers[group] = [];
    for (const frame of HOME_CONSTRUCTION.frameSequence.filter((candidate) => candidate.group === group)) {
      const cell = sourceCell(atlas, frame.index, 128, 128);
      placeOpaque(proof, cell, HOME_CONSTRUCTION.origin.x, HOME_CONSTRUCTION.origin.y);
      sourceLayers[group].push({
        atlasId: `${kit}-home-components`,
        pngSha256: atlas.pngSha256,
        cell: frame.index,
        group,
        sourceRect: {
          x: frame.index % (atlas.width / 128) * 128,
          y: Math.floor(frame.index / (atlas.width / 128)) * 128,
          width: 128,
          height: 128,
        },
        sourceRgbaSha256: sha256(cell.data),
      });
    }
    groups[group] = cropRaw(proof, HOME_CONSTRUCTION.origin.x, HOME_CONSTRUCTION.origin.y, 128, 128);
  }
  return { ...groups, sourceLayers };
}

function contactShadowRaw(scenePlacement) {
  const color = [...hexRgb(REGIONAL_R5_PALETTES.shared[SHADOW.colorToken]), 255];
  const raw = emptyRaw();
  const instances = [];
  for (const human of scenePlacement.humans) {
    const value = shadowCoordinates(human);
    for (const [x, y] of value.coordinates) setPixel(raw, x, y, color);
    instances.push({ humanId: human.id, feet: value.feet, origin: value.origin, opaquePixels: value.coordinates.length });
  }
  return { raw, instances };
}

function maskedHomeFront(front, placement) {
  const depth = REGIONAL_R5_MECHANICS_BINDINGS.entranceDepth;
  const home = placement.homeActor.destination;
  const shelter = placement.humans.find(({ role }) => role === "shelter-door");
  assert.ok(shelter);
  const apron = {
    x: shelter.destination.x - home.x,
    y: shelter.destination.y - home.y,
    width: shelter.destination.width,
    height: shelter.destination.height,
  };
  const output = emptyRaw(front.width, front.height);
  for (let y = 0; y < front.height; y += 1) for (let x = 0; x < front.width; x += 1) {
    const offset = (y * front.width + x) * 4;
    if (front.data[offset + 3] === 0) continue;
    const inRect = (rect) => x >= rect.x && x < rect.x + rect.width
      && y >= rect.y && y < rect.y + rect.height;
    const inPortal = inRect(depth.portal);
    const inThreshold = inRect(depth.threshold);
    const inForeground = inRect(depth.thresholdForegroundBand);
    const inApron = inRect(apron);
    if ((inPortal || inApron) && !(inThreshold && inForeground)) continue;
    front.data.copy(output.data, offset, offset, offset + 4);
  }
  return output;
}

function independentDynamicScene(staticRaw, decoded, kit, placement) {
  const output = copyRaw(staticRaw);
  const yard = rawCell(decoded[`${kit}-home-yards`], `${kit}-home-yards`, placement.yard.cell);
  const home = buildHomeActor(decoded, kit);
  const human = buildCanonicalHuman(decoded);
  const shadows = contactShadowRaw(placement);
  const front = maskedHomeFront(home.front, placement);
  placeOpaque(output, yard, placement.yard.destination.x, placement.yard.destination.y);
  placeOpaque(output, home.back, placement.homeActor.destination.x, placement.homeActor.destination.y);
  placeOpaque(output, shadows.raw, 0, 0);
  const humans = placement.humans.map((candidate) => ({
    ...candidate,
    feet: { x: candidate.destination.x + HUMAN.feet.x, y: candidate.destination.y + HUMAN.feet.y },
  })).sort((left, right) => left.feet.y - right.feet.y
    || left.feet.x - right.feet.x || compareText(left.id, right.id));
  for (const witness of humans) placeOpaque(output, human.raw, witness.destination.x, witness.destination.y);
  placeOpaque(output, front, placement.homeActor.destination.x, placement.homeActor.destination.y);
  return { raw: output, yard, home, human, shadows, maskedFront: front, humans };
}

function shadowCoordinates(humanPlacement) {
  const feet = {
    x: humanPlacement.destination.x + HUMAN.feet.x,
    y: humanPlacement.destination.y + HUMAN.feet.y,
  };
  const origin = { x: feet.x - SHADOW.anchor.x, y: feet.y - SHADOW.anchor.y };
  const coordinates = [];
  for (let y = 0; y < SHADOW.geometry.height; y += 1) {
    for (let x = 0; x < SHADOW.geometry.width; x += 1) {
      if (SHADOW.rows[y][x] === "1") coordinates.push([origin.x + x, origin.y + y]);
    }
  }
  assert.equal(coordinates.length, SHADOW.geometry.opaquePixels);
  return { feet, origin, coordinates };
}

function buildStaticMasks(kit, built, decoded) {
  const scene = built.placements.scenes[kit];
  const object = new Uint8Array(SCENE.width * SCENE.height);
  const tallLandmark = new Uint8Array(object.length);
  const canopy = new Uint8Array(object.length);
  for (const layer of scene.visibleStaticLayers.slice(384)) {
    const cell = rawCell(decoded[layer.atlasId], layer.atlasId, layer.cell);
    const isTallLandmark = layer.atlasId.endsWith("-landmarks")
      && /canopy|cliff|containment|grove|oak|outcrop|pylon|ridge|sandstone|tree|willow/iu
        .test(layer.role);
    const isCanopy = /canopy|grove|oak|tree|willow/iu.test(layer.role);
    for (let y = 0; y < cell.height; y += 1) for (let x = 0; x < cell.width; x += 1) {
      if (cell.data[(y * cell.width + x) * 4 + 3] === 0) continue;
      const sceneX = layer.destination.x + x;
      const sceneY = layer.destination.y + y;
      if (sceneX < 0 || sceneY < 0 || sceneX >= SCENE.width || sceneY >= SCENE.height) continue;
      const index = sceneY * SCENE.width + sceneX;
      object[index] = 1;
      if (isTallLandmark) tallLandmark[index] = 1;
      if (isCanopy) canopy[index] = 1;
    }
  }
  return { object, tallLandmark, canopy };
}

function terrainCellAt(placements, x, y) {
  assert.ok(x >= 0 && y >= 0 && x < SCENE.width && y < SCENE.height,
    `scene coordinate ${x},${y} out of bounds`);
  const tileIndex = Math.floor(y / 32) * 24 + Math.floor(x / 32);
  return placements.visibleStaticLayers[tileIndex].cell;
}

function isRegionalWalkable(cell) {
  return (cell >= 0 && cell <= 15) || (cell >= 32 && cell <= 35);
}

function rectsOverlap(left, right) {
  return left.x < right.x + right.width && right.x < left.x + left.width
    && left.y < right.y + right.height && right.y < left.y + left.height;
}

function maskForColors(raw, colors) {
  const keys = new Set(colors.map((color) => color.join(",")));
  const mask = new Uint8Array(raw.width * raw.height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 4;
    if (raw.data[offset + 3] !== 0
        && keys.has(`${raw.data[offset]},${raw.data[offset + 1]},${raw.data[offset + 2]}`)) mask[pixel] = 1;
  }
  return mask;
}

function countLiteralRgb(raw, rgbKeys) {
  const keys = new Set(rgbKeys);
  let count = 0;
  for (let pixel = 0; pixel < raw.width * raw.height; pixel += 1) {
    const offset = pixel * 4;
    if (raw.data[offset + 3] !== 0
        && keys.has(`${raw.data[offset]},${raw.data[offset + 1]},${raw.data[offset + 2]}`)) count += 1;
  }
  return count;
}

function testOwnedAshInfrastructureMetrics(raw, contract) {
  const allowed = new Set(contract.allowedInfrastructureRgb);
  const service = new Set(contract.serviceMaterialRgb);
  const serviceMask = new Uint8Array(raw.width * raw.height);
  let opaquePixels = 0;
  let warningOchrePixels = 0;
  let longestHorizontalRun = 0;
  for (let y = 0; y < raw.height; y += 1) {
    let horizontalRun = 0;
    for (let x = 0; x < raw.width; x += 1) {
      const pixel = y * raw.width + x;
      const offset = pixel * 4;
      if (raw.data[offset + 3] === 0) {
        horizontalRun = 0;
        continue;
      }
      opaquePixels += 1;
      const rgb = `${raw.data[offset]},${raw.data[offset + 1]},${raw.data[offset + 2]}`;
      assert.equal(allowed.has(rgb), true,
        `Ash infrastructure contains non-literal material ${rgb}`);
      if (!service.has(rgb)) {
        horizontalRun = 0;
        continue;
      }
      serviceMask[pixel] = 1;
      horizontalRun += 1;
      longestHorizontalRun = Math.max(longestHorizontalRun, horizontalRun);
      if (rgb === "197,162,83") warningOchrePixels += 1;
    }
  }
  const material = maskMetrics(serviceMask, raw.width, raw.height);
  const largest = material.largest ?? { pixels: 0, width: 0, height: 0 };
  return {
    connectedMaterialShare: largest.pixels / Math.max(1, material.pixels),
    directionalAspect: largest.width / Math.max(1, largest.height),
    directionalSpanPixels: largest.width,
    longestHorizontalRun,
    opaquePixels,
    serviceMaterialPixels: material.pixels,
    warningOchrePixels,
  };
}

function alphaMask(raw) {
  const mask = new Uint8Array(raw.width * raw.height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) mask[pixel] = raw.data[pixel * 4 + 3] !== 0 ? 1 : 0;
  return mask;
}

function maskMetrics(mask, width, height) {
  const seen = new Uint8Array(mask.length);
  const components = [];
  for (let origin = 0; origin < mask.length; origin += 1) {
    if (mask[origin] === 0 || seen[origin] !== 0) continue;
    const queue = [origin];
    seen[origin] = 1;
    let cursor = 0;
    let pixels = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    while (cursor < queue.length) {
      const pixel = queue[cursor++];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      pixels += 1;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nextX = x + dx;
        const nextY = y + dy;
        const next = nextY * width + nextX;
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height
            || seen[next] !== 0 || mask[next] === 0) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    components.push({ pixels, minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 });
  }
  components.sort((left, right) => right.pixels - left.pixels);
  return { components, pixels: components.reduce((sum, value) => sum + value.pixels, 0), largest: components[0] };
}

function testOwnedLandmarkMaterialDepth(raw) {
  const opaque = alphaMask(raw);
  const alpha = maskMetrics(opaque, raw.width, raw.height);
  const silhouette = alpha.largest ?? {
    pixels: 0, minX: 0, minY: 0, maxX: -1, maxY: -1, width: 0, height: 0,
  };
  const frequencies = new Map();
  let differingEdges = 0;
  let horizontalDifferingEdges = 0;
  let verticalDifferingEdges = 0;
  let internalEdges = 0;
  for (let y = 0; y < raw.height; y += 1) for (let x = 0; x < raw.width; x += 1) {
    const pixel = y * raw.width + x;
    if (opaque[pixel] === 0) continue;
    const offset = pixel * 4;
    const color = `${raw.data[offset]},${raw.data[offset + 1]},${raw.data[offset + 2]},${raw.data[offset + 3]}`;
    frequencies.set(color, (frequencies.get(color) ?? 0) + 1);
    for (const [otherX, otherY, axis] of [[x + 1, y, "horizontal"], [x, y + 1, "vertical"]]) {
      if (otherX >= raw.width || otherY >= raw.height) continue;
      const otherPixel = otherY * raw.width + otherX;
      if (opaque[otherPixel] === 0) continue;
      internalEdges += 1;
      const otherOffset = otherPixel * 4;
      const otherColor = `${raw.data[otherOffset]},${raw.data[otherOffset + 1]},${raw.data[otherOffset + 2]},${raw.data[otherOffset + 3]}`;
      if (color === otherColor) continue;
      differingEdges += 1;
      if (axis === "horizontal") horizontalDifferingEdges += 1;
      else verticalDifferingEdges += 1;
    }
  }
  let tinyColorComponentPixels = 0;
  for (const color of frequencies.keys()) {
    const colorMask = new Uint8Array(opaque.length);
    for (let pixel = 0; pixel < opaque.length; pixel += 1) {
      if (opaque[pixel] === 0) continue;
      const offset = pixel * 4;
      const candidate = `${raw.data[offset]},${raw.data[offset + 1]},${raw.data[offset + 2]},${raw.data[offset + 3]}`;
      if (candidate === color) colorMask[pixel] = 1;
    }
    tinyColorComponentPixels += maskMetrics(colorMask, raw.width, raw.height).components
      .filter(({ pixels }) => pixels < 3)
      .reduce((sum, { pixels }) => sum + pixels, 0);
  }
  let groundContactPixels = 0;
  if (silhouette.height > 0) {
    for (let y = Math.max(silhouette.minY, silhouette.maxY - 3); y <= silhouette.maxY; y += 1) {
      for (let x = silhouette.minX; x <= silhouette.maxX; x += 1) {
        groundContactPixels += opaque[y * raw.width + x];
      }
    }
  }
  const opaquePixels = alpha.pixels;
  return {
    alphaCoverageWithinBounds: silhouette.pixels
      / Math.max(1, silhouette.width * silhouette.height),
    connectedSilhouetteShare: silhouette.pixels / Math.max(1, opaquePixels),
    differingColorEdgeDensity: differingEdges / Math.max(1, internalEdges),
    dominantColorShare: Math.max(0, ...frequencies.values()) / Math.max(1, opaquePixels),
    groundContactPixels,
    horizontalDifferingEdgeShare: horizontalDifferingEdges / Math.max(1, differingEdges),
    opaqueColorCount: frequencies.size,
    significantColorCount: [...frequencies.values()].filter((count) => (
      count / Math.max(1, opaquePixels) >= TEST_LANDMARK_LIMITS.significantShareMin
    )).length,
    silhouetteHeight: silhouette.height,
    silhouetteWidth: silhouette.width,
    tinyComponentShare: tinyColorComponentPixels / Math.max(1, opaquePixels),
    transparentNegativeSpace: 1 - opaquePixels / (raw.width * raw.height),
    verticalDifferingEdgeShare: verticalDifferingEdges / Math.max(1, differingEdges),
  };
}

function testOwnedLandmarkMaterialFailures(raw, label) {
  const value = testOwnedLandmarkMaterialDepth(raw);
  const limit = TEST_LANDMARK_LIMITS;
  const failures = [];
  if (value.opaqueColorCount < limit.colorsMin) failures.push(`${label}: too few opaque colors`);
  if (value.significantColorCount < limit.significantColorsMin) failures.push(`${label}: too few significant colors`);
  if (value.dominantColorShare > limit.dominantShareMax) failures.push(`${label}: one color dominates`);
  if (value.differingColorEdgeDensity < limit.differingEdgeDensityMin
      || value.differingColorEdgeDensity > limit.differingEdgeDensityMax) failures.push(`${label}: material edge density out of bounds`);
  if (value.tinyComponentShare > limit.tinyComponentShareMax) failures.push(`${label}: color speckle exceeds literal limit`);
  if (value.silhouetteWidth < limit.silhouetteWidthMin
      || value.silhouetteHeight < limit.silhouetteHeightMin) failures.push(`${label}: silhouette is too slight`);
  if (value.connectedSilhouetteShare < limit.connectedSilhouetteShareMin) failures.push(`${label}: silhouette is disconnected`);
  if (value.alphaCoverageWithinBounds > limit.alphaCoverageWithinBoundsMax) failures.push(`${label}: silhouette is a filled block`);
  if (value.horizontalDifferingEdgeShare < limit.horizontalEdgeShareMin
      || value.verticalDifferingEdgeShare < limit.verticalEdgeShareMin
      || value.silhouetteWidth / Math.max(1, value.silhouetteHeight) > 2) failures.push(`${label}: material anatomy lacks two-axis depth`);
  if (value.transparentNegativeSpace <= limit.transparentNegativeSpaceMin) failures.push(`${label}: negative space missing`);
  if (value.groundContactPixels < limit.groundContactPixelsMin) failures.push(`${label}: ground contact missing`);
  return failures;
}

function terrainOnlyScene(placements, decoded) {
  const output = emptyRaw();
  for (const layer of placements.visibleStaticLayers.slice(0, 384)) {
    placeOpaque(output, rawCell(decoded[layer.atlasId], layer.atlasId, layer.cell),
      layer.destination.x, layer.destination.y);
  }
  return output;
}

function terrainResidualCorrelation(raw, placements, dxTiles, dyTiles) {
  const size = TEST_TERRAIN_LIMITS.cellPixels;
  const columns = raw.width / size;
  const rows = raw.height / size;
  const eligible = new Set(placements.visibleStaticLayers.slice(0, 384)
    .map((layer, index) => (layer.cell >= 0 && layer.cell <= 7 ? index : -1))
    .filter((index) => index >= 0));
  const residuals = new Float64Array(raw.width * raw.height * 3);
  for (const tile of eligible) {
    const tileX = tile % columns;
    const tileY = Math.floor(tile / columns);
    const sums = [0, 0, 0];
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const offset = ((tileY * size + y) * raw.width + tileX * size + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) sums[channel] += raw.data[offset + channel];
    }
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const pixel = (tileY * size + y) * raw.width + tileX * size + x;
      for (let channel = 0; channel < 3; channel += 1) {
        residuals[pixel * 3 + channel] = raw.data[pixel * 4 + channel] - sums[channel] / (size * size);
      }
    }
  }
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  let count = 0;
  let pairs = 0;
  for (const tile of eligible) {
    const tileX = tile % columns;
    const tileY = Math.floor(tile / columns);
    const otherX = tileX + dxTiles;
    const otherY = tileY + dyTiles;
    if (otherX >= columns || otherY >= rows) continue;
    const other = otherY * columns + otherX;
    if (!eligible.has(other)) continue;
    pairs += 1;
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const left = (tileY * size + y) * raw.width + tileX * size + x;
      const right = (otherY * size + y) * raw.width + otherX * size + x;
      for (let channel = 0; channel < 3; channel += 1) {
        const a = residuals[left * 3 + channel];
        const b = residuals[right * 3 + channel];
        sumA += a; sumB += b; sumAA += a * a; sumBB += b * b; sumAB += a * b;
        count += 1;
      }
    }
  }
  const covariance = sumAB - sumA * sumB / Math.max(1, count);
  const varianceA = sumAA - sumA * sumA / Math.max(1, count);
  const varianceB = sumBB - sumB * sumB / Math.max(1, count);
  const denominator = Math.sqrt(Math.max(0, varianceA) * Math.max(0, varianceB));
  return {
    correlation: denominator > 1e-9 ? Math.abs(covariance / denominator) : 0,
    denominator,
    eligible,
    pairs,
    residuals,
  };
}

function testOwnedTerrainAutocorrelationFailures(raw, placements, label) {
  const failures = [];
  let phaseLockedEnergy = null;
  for (let multiple = 1; multiple <= TEST_TERRAIN_LIMITS.maximumShiftTiles; multiple += 1) {
    for (const [axis, dx, dy] of [["x", multiple, 0], ["y", 0, multiple]]) {
      const value = terrainResidualCorrelation(raw, placements, dx, dy);
      if (value.pairs === 0 || value.denominator <= 1e-9) {
        failures.push(`${label}: ${axis}${multiple} has no independent residual denominator`);
      } else if (value.correlation > TEST_TERRAIN_LIMITS.residualAutocorrelationMax) {
        failures.push(`${label}: ${axis}${multiple} residual correlation ${value.correlation.toFixed(4)} > 0.28`);
      }
      if (phaseLockedEnergy === null) {
        const size = TEST_TERRAIN_LIMITS.cellPixels;
        const phaseSums = new Float64Array(size * size * 3);
        let totalEnergy = 0;
        for (const tile of value.eligible) {
          const tileX = tile % (raw.width / size);
          const tileY = Math.floor(tile / (raw.width / size));
          for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
            const pixel = (tileY * size + y) * raw.width + tileX * size + x;
            for (let channel = 0; channel < 3; channel += 1) {
              const residual = value.residuals[pixel * 3 + channel];
              phaseSums[(y * size + x) * 3 + channel] += residual;
              totalEnergy += residual * residual;
            }
          }
        }
        const lockedEnergy = phaseSums.reduce((sum, valueAtPhase) => (
          sum + (valueAtPhase / Math.max(1, value.eligible.size)) ** 2
        ), 0);
        phaseLockedEnergy = lockedEnergy
          / Math.max(1e-9, totalEnergy / Math.max(1, value.eligible.size));
      }
    }
  }
  if (phaseLockedEnergy > TEST_TERRAIN_LIMITS.phaseLockedEnergyMax) {
    failures.push(`${label}: phase-locked residual energy ${phaseLockedEnergy.toFixed(4)} > 0.10`);
  }
  return failures;
}

function masksWithinDistance(left, right, width, height, distance) {
  for (let pixel = 0; pixel < left.length; pixel += 1) {
    if (left[pixel] === 0) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    for (let dy = -distance; dy <= distance; dy += 1) for (let dx = -distance; dx <= distance; dx += 1) {
      if (Math.abs(dx) + Math.abs(dy) > distance) continue;
      const candidateX = x + dx;
      const candidateY = y + dy;
      if (candidateX >= 0 && candidateY >= 0 && candidateX < width && candidateY < height
          && right[candidateY * width + candidateX] !== 0) return true;
    }
  }
  return false;
}

function paletteColors(kit, tokens) {
  return tokens.map((token) => {
    for (const candidateKit of [kit, "spring-terraces", "neutral-temperate"]) {
      const value = REGIONAL_R5_PALETTES.kits[candidateKit]?.[token];
      if (value) return hexRgb(value);
    }
    throw new Error(`${kit}/${token}: palette token absent`);
  });
}

function rectangularFrameMetrics(raw, authoritativePorts = {}) {
  const mask = alphaMask(raw);
  const decorativeEdgeMask = Uint8Array.from(mask);
  for (const [direction, spans] of Object.entries(authoritativePorts)) {
    for (const [start, end] of spans) for (let offset = start; offset <= end; offset += 1) {
      const pixel = direction === "n" ? offset
        : direction === "s" ? (raw.height - 1) * raw.width + offset
          : direction === "w" ? offset * raw.width
            : offset * raw.width + raw.width - 1;
      decorativeEdgeMask[pixel] = 0;
    }
  }
  const perimeter = [];
  const decorativePerimeter = [];
  for (let x = 0; x < raw.width; x += 1) perimeter.push(mask[x], mask[(raw.height - 1) * raw.width + x]);
  for (let y = 1; y < raw.height - 1; y += 1) perimeter.push(mask[y * raw.width], mask[y * raw.width + raw.width - 1]);
  for (let x = 0; x < raw.width; x += 1) decorativePerimeter.push(
    decorativeEdgeMask[x],
    decorativeEdgeMask[(raw.height - 1) * raw.width + x],
  );
  for (let y = 1; y < raw.height - 1; y += 1) decorativePerimeter.push(
    decorativeEdgeMask[y * raw.width],
    decorativeEdgeMask[y * raw.width + raw.width - 1],
  );
  let longest = 0;
  for (const line of [
    Array.from({ length: raw.width }, (_unused, x) => decorativeEdgeMask[x]),
    Array.from({ length: raw.width }, (_unused, x) => decorativeEdgeMask[(raw.height - 1) * raw.width + x]),
    Array.from({ length: raw.height }, (_unused, y) => decorativeEdgeMask[y * raw.width]),
    Array.from({ length: raw.height }, (_unused, y) => decorativeEdgeMask[y * raw.width + raw.width - 1]),
  ]) {
    let run = 0;
    for (const value of line) { run = value ? run + 1 : 0; longest = Math.max(longest, run); }
  }
  return {
    perimeterOpaqueShare: decorativePerimeter.reduce((sum, value) => sum + value, 0)
      / decorativePerimeter.length,
    uninterruptedEdgePixels: longest,
    transparentPerimeterPixels: perimeter.filter((value) => value === 0).length,
  };
}

function independentLayerRaw(layer, decoded) {
  const output = emptyRaw();
  placeOpaque(output, rawCell(decoded[layer.atlasId], layer.atlasId, layer.cell),
    layer.destination.x, layer.destination.y);
  return output;
}

function routeLayerRaw(scenePlacements, decoded) {
  const output = emptyRaw();
  for (const layer of scenePlacements.visibleStaticLayers.slice(0, 384)) {
    if (layer.cell < 8 || layer.cell > 15) continue;
    placeOpaque(output, rawCell(decoded[layer.atlasId], layer.atlasId, layer.cell),
      layer.destination.x, layer.destination.y);
  }
  return output;
}

function composeLayers(base, layers) {
  const output = copyRaw(base);
  for (const layer of layers) placeOpaque(output, layer, 0, 0);
  return output;
}

function pickupScatterMetrics(raw) {
  const { components } = maskMetrics(alphaMask(raw), raw.width, raw.height);
  const pickups = components.filter(({ pixels, width, height }) => (
    pixels <= 512 && width <= 32 && height <= 32
  ));
  return {
    components: pickups.length,
    componentShare: pickups.length / Math.max(1, components.length),
  };
}

function dilateMask(mask, width, height, radius) {
  const output = new Uint8Array(mask.length);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (mask[pixel] === 0) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      const candidateX = x + dx;
      const candidateY = y + dy;
      if (candidateX >= 0 && candidateY >= 0
          && candidateX < width && candidateY < height) {
        output[candidateY * width + candidateX] = 1;
      }
    }
  }
  return output;
}

function omitOneVisibleShare(base, orderedLayers, fullScene, omittedIndex) {
  const omitted = composeLayers(
    base,
    orderedLayers.filter((_layer, index) => index !== omittedIndex),
  );
  const source = alphaMask(orderedLayers[omittedIndex]);
  let sourcePixels = 0;
  let visibleDeltaPixels = 0;
  for (let pixel = 0; pixel < source.length; pixel += 1) {
    if (source[pixel] === 0) continue;
    sourcePixels += 1;
    const offset = pixel * 4;
    if (!omitted.data.subarray(offset, offset + 4)
      .equals(fullScene.data.subarray(offset, offset + 4))) visibleDeltaPixels += 1;
  }
  return visibleDeltaPixels / Math.max(1, sourcePixels);
}

function testOwnedClusterFailures(input, label) {
  const { width, height, baseLayer, scene, landmarkLayer, supportLayers, routeLayer } = input;
  const landmark = alphaMask(landmarkLayer);
  const route = alphaMask(routeLayer);
  const supports = supportLayers.map(alphaMask);
  const saliency = Uint8Array.from(landmark);
  for (const supportMask of supports) for (let index = 0; index < saliency.length; index += 1) {
    if (supportMask[index] !== 0) saliency[index] = 1;
  }
  const supportPixels = supports.reduce((sum, supportMask) => (
    sum + countMask(supportMask)
  ), 0);
  const isolatedSupportPixels = supports.reduce((sum, supportMask) => (
    masksWithinDistance(supportMask, landmark, width, height, 1)
      || masksWithinDistance(supportMask, route, width, height, 1)
      ? sum : sum + countMask(supportMask)
  ), 0);
  const saliencyMetrics = maskMetrics(saliency, width, height);
  const dilatedMetrics = maskMetrics(dilateMask(saliency, width, height, 1), width, height);
  const nodeMasks = [landmark, ...supports, route];
  const adjacency = nodeMasks.map(() => []);
  for (let left = 0; left < nodeMasks.length; left += 1) {
    for (let right = left + 1; right < nodeMasks.length; right += 1) {
      if (!masksWithinDistance(nodeMasks[left], nodeMasks[right], width, height, 1)) continue;
      adjacency[left].push(right);
      adjacency[right].push(left);
    }
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
  const orderedLayers = [routeLayer, landmarkLayer, ...supportLayers];
  const flattened = composeLayers(baseLayer, orderedLayers);
  const failures = [];
  const limits = TEST_CLUSTER_LIMITS;
  if (supports.length < 2) failures.push(`${label}: fewer than two support masses`);
  if (!supports.some((supportMask) => masksWithinDistance(supportMask, landmark, width, height, 1))) {
    failures.push(`${label}: no support joins landmark`);
  }
  if (!supports.some((supportMask) => masksWithinDistance(supportMask, route, width, height, 1))) {
    failures.push(`${label}: no support joins route material`);
  }
  if (reached.size !== nodeMasks.length || !reached.has(nodeMasks.length - 1)) {
    failures.push(`${label}: support graph does not connect landmark to route`);
  }
  if (dilatedMetrics.components.length > limits.maximumDilatedComponents) {
    failures.push(`${label}: radius-one cluster remains scattered`);
  }
  const dominantShare = (saliencyMetrics.largest?.pixels ?? 0)
    / Math.max(1, saliencyMetrics.pixels);
  if (dominantShare < limits.dominantMassShareMin) failures.push(`${label}: dominant material mass is too slight`);
  if (isolatedSupportPixels / Math.max(1, supportPixels)
      > limits.isolatedSupportPixelShareMax) failures.push(`${label}: isolated support mass exceeds literal limit`);
  if (1 - saliencyMetrics.pixels / (width * height)
      < limits.negativeWalkableShareMin) failures.push(`${label}: negative walkable space is too slight`);
  if (!flattened.data.equals(scene.data)) failures.push(`${label}: exact RGBA flatten mismatch`);
  for (const [index, visibleShare] of orderedLayers.map((_layer, layerIndex) => (
    omitOneVisibleShare(baseLayer, orderedLayers, flattened, layerIndex)
  )).entries()) {
    if (visibleShare < limits.omitOneVisibleShareMin) {
      failures.push(`${label}: layer ${index} visible share ${visibleShare.toFixed(4)} < 0.75`);
    }
  }
  for (const [index, supportMask] of supports.entries()) {
    const metrics = maskMetrics(supportMask, width, height);
    if (metrics.components.length !== 1) failures.push(`${label}: support ${index} is disconnected`);
    if (metrics.pixels / (width * height) > limits.supportCoverageMax) {
      failures.push(`${label}: support ${index} is generic ground coverage`);
    }
    const anatomy = metrics.largest ?? { pixels: 0, width: 0, height: 0 };
    if (anatomy.pixels < limits.supportPixelsMin || anatomy.width < limits.supportWidthMin
        || anatomy.height < limits.supportHeightMin) failures.push(`${label}: support ${index} anatomy is too slight`);
  }
  return failures;
}

function countMask(mask) {
  return mask.reduce((sum, value) => sum + value, 0);
}

function minimumManhattanDistance(left, right, width, height) {
  const distance = new Int32Array(right.length);
  distance.fill(1_000_000);
  const queue = [];
  for (let index = 0; index < right.length; index += 1) if (right[index] !== 0) {
    distance[index] = 0;
    queue.push(index);
  }
  let cursor = 0;
  while (cursor < queue.length) {
    const pixel = queue[cursor++];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
      const next = nextY * width + nextX;
      if (distance[next] <= distance[pixel] + 1) continue;
      distance[next] = distance[pixel] + 1;
      queue.push(next);
    }
  }
  let minimum = 1_000_000;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== 0) {
    minimum = Math.min(minimum, distance[index]);
  }
  return minimum;
}

function humanPlacementIsCollisionFree(destination, humanPatch, objectMask, waterMask) {
  for (let y = 0; y < humanPatch.height; y += 1) for (let x = 0; x < humanPatch.width; x += 1) {
    if (humanPatch.data[(y * humanPatch.width + x) * 4 + 3] === 0) continue;
    const sceneX = destination.x + x;
    const sceneY = destination.y + y;
    if (sceneX < 0 || sceneY < 0 || sceneX >= SCENE.width || sceneY >= SCENE.height) return false;
    const index = sceneY * SCENE.width + sceneX;
    if (objectMask[index] !== 0 || waterMask[index] !== 0) return false;
  }
  const probe = { destination };
  for (const [x, y] of shadowCoordinates(probe).coordinates) {
    if (x < 0 || y < 0 || x >= SCENE.width || y >= SCENE.height) return false;
    const index = y * SCENE.width + x;
    if (objectMask[index] !== 0 || waterMask[index] !== 0) return false;
  }
  return true;
}

function buildExplicitGroundingMasks(kit, staticRaw, yardRaw, yardDestination, objectMask) {
  const literalColors = AUTHORITY.visualStructure.shared.homeGrounding.materialRgbByKit[kit];
  assert.ok(Array.isArray(literalColors) && literalColors.length >= 4,
    `${kit}: literal grounding colors missing`);
  assert.equal(new Set(literalColors).size, literalColors.length,
    `${kit}: literal grounding colors must be unique`);
  const colors = new Set(literalColors);
  const material = new Uint8Array(SCENE.width * SCENE.height);
  const yardDelta = new Uint8Array(material.length);
  for (let pixel = 0; pixel < material.length; pixel += 1) {
    const offset = pixel * 4;
    const key = `${staticRaw.data[offset]},${staticRaw.data[offset + 1]},${staticRaw.data[offset + 2]}`;
    if (staticRaw.data[offset + 3] === 255 && objectMask[pixel] === 0 && colors.has(key)) {
      material[pixel] = 1;
    }
  }
  for (let y = 0; y < yardRaw.height; y += 1) for (let x = 0; x < yardRaw.width; x += 1) {
    const sourceOffset = (y * yardRaw.width + x) * 4;
    if (yardRaw.data[sourceOffset + 3] === 0) continue;
    const sceneX = yardDestination.x + x;
    const sceneY = yardDestination.y + y;
    if (sceneX < 0 || sceneY < 0 || sceneX >= SCENE.width || sceneY >= SCENE.height) continue;
    const pixel = sceneY * SCENE.width + sceneX;
    const destinationOffset = pixel * 4;
    const key = `${yardRaw.data[sourceOffset]},${yardRaw.data[sourceOffset + 1]},${yardRaw.data[sourceOffset + 2]}`;
    assert.equal(colors.has(key), true,
      `${kit}: yard material ${key} is outside the literal regional grounding vocabulary`);
    if (objectMask[pixel] !== 0) continue;
    material[pixel] = 1;
    if (!yardRaw.data.subarray(sourceOffset, sourceOffset + 4)
      .equals(staticRaw.data.subarray(destinationOffset, destinationOffset + 4))) {
      yardDelta[pixel] = 1;
    }
  }
  assert.ok(countMask(yardDelta) > 0, `${kit}: yard contributes no visible material delta`);
  return { material, yardDelta };
}

function sideHasTwelvePixelMaterialWindow(side, rect, groundingMasks) {
  const size = AUTHORITY.visualStructure.shared.homeGrounding.windowPixels;
  const candidates = [];
  if (side === "top" && rect.y >= size) {
    for (let x = rect.x; x <= rect.x + rect.width - size; x += 1) candidates.push([x, rect.y - size]);
  } else if (side === "bottom" && rect.y + rect.height + size <= SCENE.height) {
    for (let x = rect.x; x <= rect.x + rect.width - size; x += 1) candidates.push([x, rect.y + rect.height]);
  } else if (side === "left" && rect.x >= size) {
    for (let y = rect.y; y <= rect.y + rect.height - size; y += 1) candidates.push([rect.x - size, y]);
  } else if (side === "right" && rect.x + rect.width + size <= SCENE.width) {
    for (let y = rect.y; y <= rect.y + rect.height - size; y += 1) candidates.push([rect.x + rect.width, y]);
  }
  let hasMaterialWindow = false;
  for (const [startX, startY] of candidates) {
    let containsYardDelta = false;
    let complete = true;
    for (let y = startY; y < startY + size; y += 1) for (let x = startX; x < startX + size; x += 1) {
      const pixel = y * SCENE.width + x;
      if (groundingMasks.material[pixel] === 0) complete = false;
      if (groundingMasks.yardDelta[pixel] !== 0) containsYardDelta = true;
    }
    if (!complete) continue;
    hasMaterialWindow = true;
    if (containsYardDelta) return { containsYardDelta: true, visible: true };
  }
  return { containsYardDelta: false, visible: hasMaterialWindow };
}

test("rectangular-frame detector exempts only exact authoritative port pixels", () => {
  const raw = { width: 128, height: 128, channels: 4, data: Buffer.alloc(128 * 128 * 4) };
  const setOpaque = (x, y) => { raw.data[(y * raw.width + x) * raw.channels + 3] = 255; };
  for (let x = 0; x < raw.width; x += 1) setOpaque(x, raw.height - 1);
  assert.equal(rectangularFrameMetrics(raw).uninterruptedEdgePixels, 128);
  const portOnly = rectangularFrameMetrics(raw, { s: [[0, 127]] });
  assert.equal(portOnly.uninterruptedEdgePixels, 0);
  assert.equal(portOnly.perimeterOpaqueShare, 0);
  for (let x = 0; x < 96; x += 1) setOpaque(x, 0);
  const withDecorativeRail = rectangularFrameMetrics(raw, { s: [[0, 127]] });
  assert.equal(withDecorativeRail.uninterruptedEdgePixels, 96,
    "an unrelated decorative edge rail must remain visible to the detector");
  assert.ok(withDecorativeRail.perimeterOpaqueShare > 0,
    "unrelated decorative perimeter opacity must remain visible to the detector");
});

test("V4 scene-first production API is ready", () => {
  assert.equal(
    typeof productionPacker[API],
    "function",
    `V4_SCENE_FIRST_RED/API_MISSING: ${API}`,
  );
});

test("literal V4 authority closes the bounded repair scope and remains pre-approval", {
  skip: API_SKIP,
}, () => {
  assert.equal(canonicalDigest(AUTHORITY), REGIONAL_R5_V4_SCENE_FIRST_LITERAL_AUTHORITY_SHA256);
  assertDeeplyFrozen(AUTHORITY, "V4 literal authority");
  assertDeeplyFrozen(INTAKE_CLOSURE, "V4 intake-closure authority");
  assert.equal(INTAKE_CLOSURE.schema, "regional-r5-v4-intake-closure-authority/v1");
  assert.deepEqual(INTAKE_CLOSURE.representationOrder, [
    "non-enumerable", "symbol", "accepted-field-accessor", "custom-prototype",
  ]);
  assert.equal(INTAKE_CLOSURE.totalContainerProbeCount, 14733);
  assert.equal(INTAKE_CLOSURE.rootAccessorProbeCount, 3);
  assert.equal(INTAKE_CLOSURE.rootProxyProbeCount, 3);
  assert.equal(INTAKE_CLOSURE.nestedProxyProbeCount, 7);
  assert.equal(INTAKE_CLOSURE.maximumClosureProbeCount, 14746);
  assert.deepEqual(INTAKE_CLOSURE.surfaces, {
    builder: {
      pathCount: 301,
      kindCounts: { Array: 101, Buffer: 0, Object: 200 },
      pathSha256: "5466c2ac67093a1b8e71435bbeca4bef2d3c9991ad65c9b51ccc3e93d388d205",
    },
    staticCompositor: {
      pathCount: 4120,
      kindCounts: { Array: 5, Buffer: 20, Object: 4095 },
      pathSha256: "9f9e90c5e0b5c740abe173ee46060d844fb0adbe615936ac874dab722781ab7e",
    },
    dynamicCompositor: {
      pathCount: 10312,
      kindCounts: { Array: 13, Buffer: 19, Object: 10280 },
      pathSha256: "b6d3cb6e64666576d3ba3f83dc8f668f8962143ca845182cd8be56e9b0f67c0b",
    },
  });
  assert.equal(AUTHORITY.predecessor.generation, "v3");
  assert.equal(AUTHORITY.predecessor.immutable, true);
  assert.equal(AUTHORITY.predecessor.relabelForbidden, true);
  assert.equal(AUTHORITY.masterBoundary.count, 20);
  assert.equal(AUTHORITY.masterBoundary.names.length, 20);
  assert.deepEqual(Object.keys(AUTHORITY.predecessor.masterPngSha256).sort(compareText), MASTER_NAMES);
  assert.deepEqual(AUTHORITY.decodedPixelBudgets, {
    allMasterPixels: 2406400,
    activeSourcePixels: 1689600,
    changedCellSurfacePixels: 429056,
    activeCellsPerKit: { terrain: 36, scenery: 16, landmarks: 8, "home-yards": 5 },
  });
  assert.equal(Object.values(AUTHORITY.repairInventory)
    .flatMap(({ landmarks }) => landmarks).length, 22);
  assert.equal(Object.values(AUTHORITY.repairInventory)
    .flatMap(({ supports }) => supports).length, 47);
  assert.equal(
    AUTHORITY.repairInventory["neutral-temperate"].landmarks
      .some(({ cell, repair }) => cell === 1 && /pond.*wash-place/iu.test(repair)),
    true,
    "Neutral cell 1 is the mandatory decisive pond/wash-place repair",
  );
  assert.deepEqual(AUTHORITY.repairInventory["spring-terraces"].landmarks.map(({ cell }) => cell),
    [2, 5, 6, 7]);
  assert.deepEqual(AUTHORITY.repairInventory["dry-scrub"].landmarks.map(({ cell }) => cell),
    [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(AUTHORITY.repairInventory["worn-heartland"].landmarks.map(({ cell }) => cell),
    [3, 4, 5, 6, 7]);
  assert.deepEqual(AUTHORITY.repairInventory["ash-waste"].landmarks.map(({ cell }) => cell),
    [2, 3, 6, 7]);
  assert.deepEqual(AUTHORITY.repairInventory["ash-waste"].supports
    .filter(({ role }) => ["coral-fissure", "fissure-return"].includes(role))
    .map(({ cell, role }) => [cell, role]), [
    [3, "coral-fissure"],
    [22, "fissure-return"],
  ], "legacy volcanic Ash support roles must be explicitly repaired inside the bounded inventory");
  assert.deepEqual(AUTHORITY.clusterSupportsByLandmarkCell["neutral-temperate"], { 1: [16, 20] });
  assert.deepEqual(AUTHORITY.clusterSupportsByLandmarkCell["ash-waste"][0], [2, 3]);
  assert.deepEqual(AUTHORITY.clusterSupportsByLandmarkCell["ash-waste"][1], [18, 22]);
  assert.deepEqual(AUTHORITY.clusterSupportsByLandmarkCell["ash-waste"][3], [65, 69]);
  assert.deepEqual(AUTHORITY.preservation.predecessorExactPlacementTuplesPerScene, {
    "ash-waste": 405,
    "dry-scrub": 408,
    "neutral-temperate": 406,
    "spring-terraces": 408,
    "worn-heartland": 405,
  });
  assert.deepEqual(AUTHORITY.preservation.staticPlacementOverrides, [
    {
      kit: "ash-waste",
      id: "r5-atlas-only/ash-waste/landmark/3",
      atlasId: "ash-waste-landmarks",
      cell: 3,
      predecessorDestination: { x: 160, y: 32 },
      destination: { x: 190, y: 87 },
      rigidDelta: [30, 55],
    },
    {
      kit: "ash-waste",
      id: "r5-atlas-only/ash-waste/support/10",
      atlasId: "ash-waste-scenery",
      cell: 65,
      predecessorDestination: { x: 241, y: 128 },
      destination: { x: 271, y: 183 },
      rigidDelta: [30, 55],
    },
    {
      kit: "ash-waste",
      id: "r5-atlas-only/ash-waste/support/11",
      atlasId: "ash-waste-scenery",
      cell: 69,
      predecessorDestination: { x: 263, y: 145 },
      destination: { x: 293, y: 200 },
      rigidDelta: [30, 55],
    },
    {
      kit: "neutral-temperate",
      id: "r5-atlas-only/neutral-temperate/support/8",
      atlasId: "neutral-temperate-scenery",
      cell: 16,
      predecessorDestination: { x: 96, y: 73 },
      destination: { x: 105, y: 113 },
      rigidDelta: [9, 40],
    },
    {
      kit: "neutral-temperate",
      id: "r5-atlas-only/neutral-temperate/support/9",
      atlasId: "neutral-temperate-scenery",
      cell: 20,
      predecessorDestination: { x: 124, y: 64 },
      destination: { x: 133, y: 104 },
      rigidDelta: [9, 40],
    },
    {
      kit: "worn-heartland",
      id: "r5-atlas-only/worn-heartland/support/11",
      atlasId: "worn-heartland-scenery",
      cell: 23,
      predecessorDestination: { x: 157, y: 137 },
      destination: { x: 216, y: 175 },
      rigidDelta: [59, 38],
    },
    {
      kit: "worn-heartland",
      id: "r5-atlas-only/worn-heartland/support/12",
      atlasId: "worn-heartland-scenery",
      cell: 83,
      predecessorDestination: { x: 435, y: 365 },
      destination: { x: 397, y: 335 },
      rigidDelta: [-38, -30],
    },
    {
      kit: "worn-heartland",
      id: "r5-atlas-only/worn-heartland/support/4",
      atlasId: "worn-heartland-scenery",
      cell: 1,
      predecessorDestination: { x: 341, y: 244 },
      destination: { x: 352, y: 340 },
      rigidDelta: [11, 96],
    },
  ], "only the listed Ash, Neutral, and Worn clusters may receive their literal rigid deltas");
  const wornDynamic = AUTHORITY.dynamicPlacements.scenes["worn-heartland"];
  assert.deepEqual(wornDynamic.yard.destination,
    { x: 504, y: 352, width: 192, height: 160 });
  assert.deepEqual(wornDynamic.homeActor.destination,
    { x: 536, y: 368, width: 128, height: 128 });
  assert.deepEqual(wornDynamic.humans.map(({ role, destination }) => ({ role, destination })), [
    { role: "route-entry", destination: { x: 0, y: 96, width: 48, height: 64 } },
    { role: "defining-landmark", destination: { x: 80, y: 224, width: 48, height: 64 } },
    { role: "shelter-door", destination: { x: 616, y: 431, width: 48, height: 64 } },
  ], "Worn translates only its whole settlement +8x; unrelated humans stay fixed");
  assert.deepEqual(AUTHORITY.clusterSupportsByLandmarkCell["worn-heartland"][5], [83, 87]);
  assert.equal(AUTHORITY.repairInventory["worn-heartland"].supports
    .some(({ cell, role }) => cell === 5 && role === "field-stone"), true,
  "Worn scenery cell 5 is the disclosed yard-clearance repair outside the landmark pairs");
  assert.deepEqual(
    AUTHORITY.dynamicPlacements.scenes["ash-waste"].humans
      .find(({ role }) => role === "defining-landmark"),
    humanRecord("ash-waste", 1, "defining-landmark", 343, 260, [336, 252], 113, 15),
  );
  assert.deepEqual(
    AUTHORITY.dynamicPlacements.scenes["neutral-temperate"].humans
      .find(({ role }) => role === "route-entry"),
    humanRecord("neutral-temperate", 0, "route-entry", 169, 140, [160, 172], 1105, 41),
  );
  assert.deepEqual(Object.keys(AUTHORITY.repairProgram.orderedOperationFieldsByKind).sort(compareText), [
    "alpha-over-source", "clear-rect", "fill-ellipse", "fill-horizontal-run",
    "fill-rect", "fill-vertical-run", "stroke-polyline",
  ]);
  assert.equal(AUTHORITY.repairProgram.directPixelPayloadForbidden, true);
  assert.deepEqual(AUTHORITY.freezeAfterTrustedWitness, {
    status: "pending-trusted-witness",
    releaseApproval: false,
    task6Ready: false,
    requiredLiteralFields: [
      "masterPngSha256",
      "changedCellAfterRgbaSha256",
      "staticSceneRgbaSha256",
      "dynamicSceneRgbaSha256",
    ],
    trustedWitness: null,
  }, "the RED must not counterfeit release approval with unreviewed V4 hashes");
});

test("V4 versions identity and receipt while preserving every unlisted static placement tuple", {
  skip: API_SKIP,
}, async () => {
  const [v3Before, completeBefore] = await Promise.all([v3Build(), completeV3PublicSnapshot()]);
  const portReceipt = productionPacker[AUTHORITY.publicApis.predecessorPortReceipt]();
  assert.equal(portReceipt.canonicalSha256, canonicalDigest(withoutDigest(portReceipt)),
    "landmark-port receipt must be self-authenticating");
  assert.equal(v3Before.receipt.canonicalSha256, canonicalDigest(withoutDigest(v3Before.receipt)),
    "atomic-intake receipt must cryptographically bind the port leaf");
  assert.equal(v3Before.authoringIdentity.canonicalSha256,
    canonicalDigest(withoutDigest(v3Before.authoringIdentity)),
  "V3 authoring identity must cryptographically bind the repaired atomic receipt");
  assert.equal(completeBefore.staticScenes.trustedV3.canonicalSha256,
    canonicalDigest(withoutDigest(completeBefore.staticScenes.trustedV3)),
  "V3 static trust must cryptographically close the predecessor chain");
  assert.equal(v3Before.receipt.landmarkPortReceiptSha256, portReceipt.canonicalSha256,
    "V4 must consume the repaired V3 atomic intake with port lineage");
  assert.equal(v3Before.authoringIdentity.landmarkPortReceiptSha256, portReceipt.canonicalSha256);
  const v4 = await v4Build();
  assert.deepEqual(Reflect.ownKeys(v4).sort(compareText),
    [...AUTHORITY.resultContract.fields].sort(compareText));
  assert.equal(v4.schema, AUTHORITY.resultContract.schema);
  assert.deepEqual(v4.authority, AUTHORITY);
  assert.notStrictEqual(v4.authority, AUTHORITY, "result authority must be detached from test input");
  assertDeeplyFrozen(v4.authority, "returned V4 authority");
  assert.equal(v4.authoringIdentity.schema, AUTHORITY.resultContract.authoringIdentitySchema);
  assertExactKeys(v4.authoringIdentity, AUTHORITY.resultContract.authoringIdentityFields,
    "V4 authoring identity");
  assert.equal(v4.authoringIdentity.generation, "v4");
  assert.equal(v4.authoringIdentity.authoritySha256, REGIONAL_R5_V4_SCENE_FIRST_LITERAL_AUTHORITY_SHA256);
  assert.equal(v4.authoringIdentity.atomicIntakeReceiptSha256, v3Before.receipt.canonicalSha256);
  assert.equal(v4.authoringIdentity.predecessorAuthoringIdentitySha256,
    v3Before.authoringIdentity.canonicalSha256);
  assert.equal(v4.authoringIdentity.landmarkPortReceiptSha256, portReceipt.canonicalSha256);
  assert.equal(v4.receipt.schema, AUTHORITY.resultContract.receiptSchema);
  assertExactKeys(v4.receipt, AUTHORITY.resultContract.receiptFields, "V4 receipt");
  assert.equal(v4.receipt.canonicalSha256, canonicalDigest(withoutDigest(v4.receipt)));
  assert.equal(v4.receipt.authoritySha256,
    REGIONAL_R5_V4_SCENE_FIRST_LITERAL_AUTHORITY_SHA256);
  assert.equal(v4.receipt.atomicIntakeReceiptSha256, v3Before.receipt.canonicalSha256);
  assert.equal(v4.receipt.predecessorAuthoringIdentitySha256,
    v3Before.authoringIdentity.canonicalSha256);
  assert.equal(v4.receipt.landmarkPortReceiptSha256, portReceipt.canonicalSha256);
  assert.equal(v4.authoringIdentity.receiptSha256, v4.receipt.canonicalSha256);
  assert.equal(v4.authoringIdentity.masterSetSha256, canonicalDigest(v4.receipt.masterPngSha256));
  assert.equal(v4.authoringIdentity.placementSha256, canonicalDigest(v4.placements));
  assert.equal(v4.authoringIdentity.dynamicPlacementSha256, canonicalDigest(AUTHORITY.dynamicPlacements));
  assert.equal(v4.authoringIdentity.canonicalSha256,
    canonicalDigest(withoutDigest(v4.authoringIdentity)));
  assertDeeplyFrozen(v4.receipt, "V4 repair receipt");
  const overridesById = new Map(AUTHORITY.preservation.staticPlacementOverrides
    .map((override) => [override.id, override]));
  for (const kit of KITS) {
    const predecessorLayers = v3Before.placements.scenes[kit].visibleStaticLayers;
    const v4Layers = v4.placements.scenes[kit].visibleStaticLayers;
    assert.equal(v4Layers.length, AUTHORITY.preservation.staticLayersPerScene);
    assert.equal(predecessorLayers.length, AUTHORITY.preservation.staticLayersPerScene);
    let exactPredecessorTuples = 0;
    let appliedOverrides = 0;
    for (const [index, predecessorLayer] of predecessorLayers.entries()) {
      const v4Layer = v4Layers[index];
      const override = overridesById.get(predecessorLayer.id);
      if (override === undefined) {
        assert.deepEqual(v4Layer, predecessorLayer,
          `${kit}/${index}: unlisted predecessor placement tuple drift`);
        exactPredecessorTuples += 1;
        continue;
      }
      assert.equal(override.kit, kit, `${kit}/${index}: override attached to wrong scene`);
      assert.equal(predecessorLayer.atlasId, override.atlasId);
      assert.equal(predecessorLayer.cell, override.cell);
      assert.deepEqual(predecessorLayer.destination, override.predecessorDestination);
      assert.deepEqual(v4Layer, { ...predecessorLayer, destination: override.destination },
        `${kit}/${index}: V4 static placement must equal its one literal override`);
      assert.deepEqual([
        v4Layer.destination.x - predecessorLayer.destination.x,
        v4Layer.destination.y - predecessorLayer.destination.y,
      ], override.rigidDelta, `${kit}/${index}: literal cluster rigid delta drift`);
      appliedOverrides += 1;
    }
    assert.equal(exactPredecessorTuples,
      AUTHORITY.preservation.predecessorExactPlacementTuplesPerScene[kit],
    `${kit}: exact predecessor placement count drift`);
    assert.equal(appliedOverrides,
      AUTHORITY.preservation.staticPlacementOverrides.filter((override) => override.kit === kit).length,
    `${kit}: literal static override count drift`);
  }
  const decoded = await decodeMasters(v4.masterBuffers);
  let decodedPixels = 0;
  for (const [name, raw] of Object.entries(decoded)) {
    assertCanonicalTransparency(raw, name);
    decodedPixels += raw.width * raw.height;
  }
  assert.equal(decodedPixels, AUTHORITY.decodedPixelBudgets.allMasterPixels);

  const integration = productionPacker[AUTHORITY.publicApis.v4Identity]();
  assertExactKeys(integration, AUTHORITY.resultContract.integrationIdentityFields,
    "V4 integration identity");
  assert.equal(integration.schema, AUTHORITY.resultContract.integrationIdentitySchema);
  assert.equal(integration.generation, "v4");
  assert.equal(integration.predecessorIntegrationIdentitySha256,
    productionPacker[AUTHORITY.publicApis.predecessorIdentity]().canonicalSha256);
  assert.equal(integration.atomicIntakeReceiptSha256, v3Before.receipt.canonicalSha256);
  assert.equal(integration.landmarkPortReceiptSha256, portReceipt.canonicalSha256);
  assert.equal(integration.authoritySha256, REGIONAL_R5_V4_SCENE_FIRST_LITERAL_AUTHORITY_SHA256);
  assert.equal(integration.receiptSha256, v4.receipt.canonicalSha256);
  assert.equal(integration.masterSetSha256, v4.authoringIdentity.masterSetSha256);
  assert.equal(integration.placementSha256, v4.authoringIdentity.placementSha256);
  assert.equal(integration.dynamicPlacementSha256, v4.authoringIdentity.dynamicPlacementSha256);
  assert.equal(integration.compositorIdentitySha256,
    completeBefore.integration.compositorIdentitySha256,
  "V4 integration identity must bind the exact public atlas-only compositor identity");
  assert.equal(integration.canonicalSha256, canonicalDigest(withoutDigest(integration)));

  const staticScenes = await v4StaticScenes();
  assert.equal(staticScenes.schema, "regional-r5-atlas-only-scenes/v1");
  assert.equal(staticScenes.generation, "v4");
  assert.equal(staticScenes.published, false);
  assert.equal(staticScenes.task6Ready, false,
    "pending trusted-witness authority may not be reported Task 6 ready");
  assert.equal(staticScenes.trustedV3, undefined, "V4 may not relabel a V3 trust receipt");
  assertExactKeys(staticScenes.trustedV4, AUTHORITY.resultContract.staticTrustFields,
    "V4 static trust");
  assert.equal(staticScenes.trustedV4.schema, AUTHORITY.resultContract.staticTrustSchema);
  assert.equal(staticScenes.trustedV4.generation, "v4");
  assert.equal(staticScenes.trustedV4.integrationIdentitySha256, integration.canonicalSha256);
  assert.equal(staticScenes.trustedV4.atomicIntakeReceiptSha256, v3Before.receipt.canonicalSha256);
  assert.equal(staticScenes.trustedV4.landmarkPortReceiptSha256, portReceipt.canonicalSha256);
  assert.equal(staticScenes.trustedV4.authoritySha256,
    REGIONAL_R5_V4_SCENE_FIRST_LITERAL_AUTHORITY_SHA256);
  assert.equal(staticScenes.trustedV4.receiptSha256, v4.receipt.canonicalSha256);
  assert.equal(staticScenes.trustedV4.masterSetSha256, v4.authoringIdentity.masterSetSha256);
  assert.equal(staticScenes.trustedV4.placementSha256, v4.authoringIdentity.placementSha256);
  assert.equal(staticScenes.trustedV4.canonicalSha256,
    canonicalDigest(withoutDigest(staticScenes.trustedV4)));
  for (const kit of KITS) {
    const scene = staticScenes.scenes[kit];
    assert.deepEqual([scene.raw.width, scene.raw.height, scene.raw.channels], [768, 512, 4]);
    assert.equal(scene.rgbaSha256, sha256(scene.raw.data));
    assert.equal(scene.visibleStaticLayers.length, 408);
    const serialized = canonicalJson(scene.visibleStaticLayers);
    for (const forbidden of [
      "home-yards", "home-components", "human-body", "human-face", "human-hair",
      "human-clothing", "contact-shadow",
    ]) assert.equal(serialized.includes(forbidden), false,
      `${kit}: static receipt must remain actor-free (${forbidden})`);
  }

  const completeAfter = await completeV3PublicSnapshot();
  assert.deepEqual(completeAfter, completeBefore,
    "V4 must preserve the full V3 authority/receipt/placements/identity/port/static/dynamic public behavior");
});

test("all 408 V4 static layers are independently flattened from decoded masters and exact provenance", {
  skip: API_SKIP,
}, async () => {
  const [built, staticScenes] = await Promise.all([v4Build(), v4StaticScenes()]);
  const decoded = await decodeMasters(built.masterBuffers);
  const receipts = {};
  const sceneHashes = {};
  for (const kit of KITS) {
    const oracle = independentStaticScene(
      kit,
      built.placements.scenes[kit],
      decoded,
      built.masterBuffers,
    );
    const actual = staticScenes.scenes[kit];
    assert.deepEqual(actual.raw.data, oracle.raw.data,
      `${kit}: public static compositor differs from independent 408-layer flatten`);
    assert.deepEqual(actual.visibleStaticLayers, oracle.visibleStaticLayers,
      `${kit}: static visible-layer provenance is not byte-derived`);
    for (const [index, layer] of actual.visibleStaticLayers.entries()) {
      assertExactKeys(layer,
        ["id", "role", "destination", "contributedOpaquePixels", "provenance"],
        `${kit}/static-layer/${index}`);
      assertExactKeys(layer.provenance,
        ["atlasId", "cell", "masterPngSha256", "sourceRect", "sourceRgbaSha256"],
        `${kit}/static-layer/${index}/provenance`);
    }
    receipts[kit] = actual.visibleStaticLayers;
    sceneHashes[kit] = sha256(actual.raw.data);
  }
  assert.equal(staticScenes.trustedV4.visibleLayerReceiptSha256, canonicalDigest(receipts));
  assert.deepEqual(staticScenes.trustedV4.sceneRgbaSha256, sceneHashes);
});

test("decoded V4 masters change exactly the twenty terrain cells and literal object inventory", {
  skip: API_SKIP,
}, async () => {
  const [v3, v4] = await Promise.all([v3Build(), v4Build()]);
  const [v3Decoded, v4Decoded] = await Promise.all([
    decodeMasters(v3.masterBuffers),
    decodeMasters(v4.masterBuffers),
  ]);
  const targets = targetCellMap();
  assert.equal([...targets.values()].filter(({ family }) => family === "terrain").length, 20);
  assert.equal([...targets.values()].filter(({ family }) => family === "landmarks").length, 22);
  assert.equal([...targets.values()].filter(({ family }) => family === "scenery").length, 47);

  const observedChanged = [];
  for (const atlasId of MASTER_NAMES) {
    const geometry = geometryFor(atlasId);
    const cellCount = geometry.columns * geometry.rows;
    for (let cell = 0; cell < cellCount; cell += 1) {
      const before = rawCell(v3Decoded[atlasId], atlasId, cell);
      const after = rawCell(v4Decoded[atlasId], atlasId, cell);
      const key = `${atlasId}/${cell}`;
      if (targets.has(key)) {
        assert.notDeepEqual(after.data, before.data, `${key}: disclosed V4 repair did not change`);
        observedChanged.push(key);
      } else assert.deepEqual(after.data, before.data, `${key}: undisclosed V4 cell changed`);
    }
  }
  assert.deepEqual(observedChanged.sort(compareText), [...targets.keys()].sort(compareText));
  assert.deepEqual(
    Object.fromEntries(MASTER_NAMES.map((name) => [name, sha256(v3.masterBuffers[name])])),
    AUTHORITY.predecessor.masterPngSha256,
    "repair sources must be the exact immutable V3 encoded masters",
  );
  assert.deepEqual(v4.receipt.masterPngSha256,
    Object.fromEntries(MASTER_NAMES.map((name) => [name, sha256(v4.masterBuffers[name])])));
  for (const kit of KITS) assert.deepEqual(
    v4.masterBuffers[`${kit}-home-yards`],
    v3.masterBuffers[`${kit}-home-yards`],
    `${kit}: yard source bytes must remain exact V3 bytes`,
  );

  const receiptKeys = v4.receipt.repairedCells.map(({ atlasId, cell }) => `${atlasId}/${cell}`);
  assert.deepEqual(receiptKeys.sort(compareText), [...targets.keys()].sort(compareText));
  assert.equal(v4.receipt.repairedCells.filter(({ family }) => family === "terrain").length, 20,
    "all twenty quiet-terrain repairs must be disclosed in lineage");
  for (const record of v4.receipt.repairedCells) {
    assertExactKeys(record, AUTHORITY.resultContract.repairedCellFields,
      `${record.atlasId}/${record.cell}/repair receipt`);
    const key = `${record.atlasId}/${record.cell}`;
    const target = targets.get(key);
    assert.ok(target, `${key}: repair lineage exceeds literal authority`);
    assert.equal(record.family, target.family);
    assert.equal(record.role, target.role);
    const before = rawCell(v3Decoded[record.atlasId], record.atlasId, record.cell);
    const after = rawCell(v4Decoded[record.atlasId], record.atlasId, record.cell);
    assert.equal(record.beforeRgbaSha256, sha256(before.data), `${key}: predecessor hash drift`);
    assert.equal(record.afterRgbaSha256, sha256(after.data), `${key}: V4 result hash is not byte-derived`);
    assert.notEqual(record.beforeRgbaSha256, record.afterRgbaSha256, `${key}: false repair lineage`);
    assert.equal(record.encodedMasterPngSha256, sha256(v4.masterBuffers[record.atlasId]));
    const replayed = replayRepairProgram(record.atlasId.slice(0, -(`-${record.family}`).length),
      record, before);
    assert.deepEqual(replayed.data, after.data,
      `${key}: exact source/crop/destination/ordered repair operations do not reconstruct the cell`);
    const changedPixels = pixelDifferenceCount(before, after);
    assert.equal(record.changedPixels, changedPixels, `${key}: changed-pixel budget is not byte-derived`);
    assert.ok(changedPixels >= AUTHORITY.repairProgram.minimumChangedPixelsByFamily[record.family],
      `${key}: semantically vacuous or one-pixel repair (${changedPixels})`);
    assert.equal(
      /actorless|directPixels|full-world|fullWorld|guidePixels|pixels|rgba|sceneMask|sceneX|sceneY/u
        .test(canonicalJson(record.orderedOperations)),
      false,
      `${key}: repair program reaches forbidden scene-position/direct-pixel material`,
    );
  }
  const activePixelsPerKit = 36 * 32 * 32 + 16 * 32 * 32
    + 8 * 128 * 128 + 5 * 192 * 160;
  assert.equal(activePixelsPerKit * KITS.length, AUTHORITY.decodedPixelBudgets.activeSourcePixels);
  const changedSurfacePixels = [...targets.values()].reduce((sum, { family }) => {
    const geometry = AUTHORITY.masterBoundary.geometryByFamily[family];
    return sum + geometry.cellWidth * geometry.cellHeight;
  }, 0);
  assert.equal(changedSurfacePixels, AUTHORITY.decodedPixelBudgets.changedCellSurfacePixels);
});

test("V4 landmark ports and all five route graphs preserve exact V3 topology", {
  skip: API_SKIP,
}, async () => {
  const built = await v4Build();
  const decoded = await decodeMasters(built.masterBuffers);
  const portReceipt = productionPacker[AUTHORITY.publicApis.predecessorPortReceipt]();
  assert.equal(portReceipt.schema, "regional-r5-v3-landmark-port-receipt/v1",
    "V3 port receipt must remain a V3 receipt");
  for (const kit of KITS) {
    const landmarkAtlas = `${kit}-landmarks`;
    for (const [cell, expectedEdges] of PORTS.landmarkPorts[kit]) {
      const raw = rawCell(decoded[landmarkAtlas], landmarkAtlas, cell);
      const actualEdges = Object.fromEntries(DIRECTION_NAMES.map((direction) => [
        direction,
        alphaEdgeSpans(raw, direction),
      ]));
      assert.deepEqual(actualEdges, expectedEdges,
        `${kit}/landmark/${cell}: V4 must preserve exact V3 edge ports`);
    }

    const route = parseRoute(PORTS.routes[kit].path);
    const routeKeys = new Set(route.map(tileKey));
    const [start, next] = route;
    const previous = route.at(-2);
    const terminus = route.at(-1);
    const entryDirection = directionFor(start[0] - next[0], start[1] - next[1]);
    const homeDirection = directionFor(terminus[0] - previous[0], terminus[1] - previous[1]);
    assert.deepEqual(terminus, PORTS.routes[kit].doorTile);
    const terrainAtlas = `${kit}-terrain`;
    const ground = rawCell(decoded[terrainAtlas], terrainAtlas, 0);
    const groundRgb = rgbaAt(ground, 0, 0).slice(0, 3);
    let offMapCount = 0;
    let homeCount = 0;
    for (const [x, y] of route) {
      const placement = built.placements.scenes[kit].visibleStaticLayers[y * 24 + x];
      const selected = rawCell(decoded[terrainAtlas], terrainAtlas, placement.cell);
      const actualPorts = DIRECTION_NAMES.filter((direction) => (
        colorEdgeHasPort(selected, direction, groundRgb)
      ));
      const expectedPorts = DIRECTION_NAMES.filter((direction) => {
        const [dx, dy] = DIRECTIONS[direction];
        const neighbor = routeKeys.has(tileKey([x + dx, y + dy]));
        const isEntry = x === start[0] && y === start[1] && direction === entryDirection;
        const isHome = x === terminus[0] && y === terminus[1] && direction === homeDirection;
        if (isEntry) offMapCount += 1;
        if (isHome) homeCount += 1;
        return neighbor || isEntry || isHome;
      });
      assert.deepEqual(actualPorts, expectedPorts,
        `${kit}/${x},${y}: missing join or unexplained route stub`);
    }
    assert.equal(offMapCount, 1, `${kit}: exactly one off-map route continuation`);
    assert.equal(homeCount, 1, `${kit}: exactly one yard/HomeActor route connector`);
  }
});

test("decoded V4 pixels form region-specific joined scenes without wallpaper, pickups, frames, or flat landmarks", {
  skip: API_SKIP,
}, async () => {
  const [built, staticScenes] = await Promise.all([v4Build(), v4StaticScenes()]);
  const decoded = await decodeMasters(built.masterBuffers);
  const changedLandmarks = {};
  for (const kit of KITS) {
    changedLandmarks[kit] = Object.fromEntries(AUTHORITY.repairInventory[kit].landmarks.map(({ cell }) => {
      const raw = rawCell(decoded[`${kit}-landmarks`], `${kit}-landmarks`, cell);
      assert.deepEqual(testOwnedLandmarkMaterialFailures(raw, `${kit}/landmark/${cell}`), [],
        `${kit}/landmark/${cell}: flat or materially shallow landmark`);
      return [cell, raw];
    }));

    const placementScene = built.placements.scenes[kit];
    const terrainOnly = terrainOnlyScene(placementScene, decoded);
    assert.deepEqual(
      testOwnedTerrainAutocorrelationFailures(terrainOnly, placementScene, `${kit}/V4-terrain`),
      [],
      `${kit}: quiet terrain remains phase-locked wallpaper`,
    );
    const route = routeLayerRaw(placementScene, decoded);
    const objectOverlay = emptyRaw();
    for (const layer of placementScene.visibleStaticLayers.slice(384)) {
      placeOpaque(objectOverlay, rawCell(decoded[layer.atlasId], layer.atlasId, layer.cell),
        layer.destination.x, layer.destination.y);
    }
    const scatter = pickupScatterMetrics(objectOverlay);
    const scatterLimits = AUTHORITY.visualStructure.shared.pickupScatter;
    assert.ok(scatter.components <= scatterLimits.maximumComponents,
      `${kit}: ${scatter.components} pickup components exceed ${scatterLimits.maximumComponents}`);
    assert.ok(scatter.componentShare <= scatterLimits.maximumComponentShare,
      `${kit}: pickup component share ${scatter.componentShare} exceeds ${scatterLimits.maximumComponentShare}`);

    for (const [landmarkCell, supportCells] of Object.entries(
      AUTHORITY.clusterSupportsByLandmarkCell[kit],
    )) {
      const landmarkPlacement = placementScene.visibleStaticLayers.find((layer) => (
        layer.atlasId === `${kit}-landmarks` && layer.cell === Number(landmarkCell)
      ));
      assert.ok(landmarkPlacement, `${kit}/landmark/${landmarkCell}: placement missing`);
      const supportPlacements = supportCells.map((cell) => {
        const layer = placementScene.visibleStaticLayers.find((candidate) => (
          candidate.atlasId === `${kit}-scenery` && candidate.cell === cell
        ));
        assert.ok(layer, `${kit}/support/${cell}: placement missing`);
        return layer;
      });
      const landmarkLayer = independentLayerRaw(landmarkPlacement, decoded);
      const supportLayers = supportPlacements.map((layer) => independentLayerRaw(layer, decoded));
      const clusterScene = composeLayers(emptyRaw(), [route, landmarkLayer, ...supportLayers]);
      assert.deepEqual(testOwnedClusterFailures({
        width: SCENE.width,
        height: SCENE.height,
        baseLayer: emptyRaw(),
        scene: clusterScene,
        landmarkLayer,
        supportLayers,
        routeLayer: route,
      }, `${kit}/landmark/${landmarkCell}`), [],
      `${kit}/landmark/${landmarkCell}: landmark and supports are not one material route-connected cluster`);
    }
  }

  const ash = AUTHORITY.visualStructure["ash-waste"];
  const ashCells = Object.values(changedLandmarks["ash-waste"]);
  for (const token of ash.requiredTokens) {
    const rgb = paletteColors("ash-waste", [token]);
    assert.ok(ashCells.reduce((sum, raw) => sum + countMask(maskForColors(raw, rgb)), 0) > 0,
      `ash-waste: required industrial material ${token} missing`);
  }
  assert.ok(ashCells.reduce((sum, raw) => sum + countMask(maskForColors(raw,
    paletteColors("ash-waste", ash.requiredTokens))), 0) >= ash.minimumIndustrialPixels,
  "ash-waste: industrial material mass is too slight");
  assert.equal(ashCells.reduce((sum, raw) => sum + countMask(maskForColors(raw,
    paletteColors("ash-waste", ash.forbiddenTokens))), 0), 0,
  "ash-waste: forbidden volcanic coral/vent vocabulary remains");
  const ashObjectLayers = built.placements.scenes["ash-waste"].visibleStaticLayers.slice(384);
  const repairedLegacySupports = new Set(AUTHORITY.repairInventory["ash-waste"].supports
    .filter(({ role }) => ash.repairedLegacyVolcanicSupportRoles.includes(role))
    .map(({ cell }) => cell));
  for (const layer of ashObjectLayers) {
    const family = layer.atlasId.endsWith("-landmarks") ? "landmarks" : "scenery";
    const raw = rawCell(decoded[layer.atlasId], layer.atlasId, layer.cell);
    assert.equal(countLiteralRgb(raw, ash.forbiddenRgb), 0,
      `ash-waste/${family}/${layer.cell}/${layer.role}: volcanic material color remains anywhere in the object scene`);
    if (ash.repairedLegacyVolcanicSupportRoles.includes(layer.role)) {
      assert.equal(family, "scenery");
      assert.equal(repairedLegacySupports.has(layer.cell), true,
        `ash-waste/${layer.role}/${layer.cell}: legacy volcanic role escaped the bounded repair inventory`);
      const repair = AUTHORITY.repairInventory["ash-waste"].supports
        .find(({ cell }) => cell === layer.cell);
      assert.match(repair.repair, /industrial|containment/iu,
        `ash-waste/${layer.role}/${layer.cell}: repair must translate the role into nuclear-industrial service infrastructure`);
    }
  }
  const ashPlacementScene = built.placements.scenes["ash-waste"];
  const ashRouteLayer = routeLayerRaw(ashPlacementScene, decoded);
  for (const [cellText, proof] of Object.entries(ash.legacySupportProofs)) {
    const cell = Number(cellText);
    const raw = rawCell(decoded["ash-waste-scenery"], "ash-waste-scenery", cell);
    const metrics = testOwnedAshInfrastructureMetrics(raw, ash);
    assert.ok(metrics.opaquePixels >= proof.minimumOpaquePixels,
      `ash-waste/support/${cell}: nuclear-industrial structure is too slight`);
    assert.ok(metrics.serviceMaterialPixels >= proof.minimumServiceMaterialPixels,
      `ash-waste/support/${cell}: service material mass is too slight`);
    assert.ok(metrics.warningOchrePixels >= proof.minimumWarningOchrePixels,
      `ash-waste/support/${cell}: warning-ochre service marking is missing`);
    assert.ok(metrics.directionalSpanPixels >= proof.minimumDirectionalSpanPixels
      && metrics.directionalAspect >= proof.minimumDirectionalAspect,
    `ash-waste/support/${cell}: cable-trench/drainage direction is not legible`);
    assert.ok(metrics.longestHorizontalRun >= proof.minimumLongestHorizontalRun,
      `ash-waste/support/${cell}: directional service run is too short`);
    assert.ok(metrics.connectedMaterialShare >= proof.minimumConnectedMaterialShare,
      `ash-waste/support/${cell}: service materials do not form one connected anatomy`);
    const repairReceipt = built.receipt.repairedCells.find((candidate) => (
      candidate.atlasId === "ash-waste-scenery" && candidate.cell === cell
    ));
    assert.ok(repairReceipt, `ash-waste/support/${cell}: bounded repair receipt missing`);
    assert.ok(repairReceipt.changedPixels
      >= AUTHORITY.repairProgram.minimumChangedPixelsByFamily.scenery,
    `ash-waste/support/${cell}: legacy volcanic pixels were not materially reauthored`);

    const landmarkPlacement = ashPlacementScene.visibleStaticLayers.find((layer) => (
      layer.atlasId === "ash-waste-landmarks" && layer.cell === proof.landmarkCell
    ));
    const companionPlacement = ashPlacementScene.visibleStaticLayers.find((layer) => (
      layer.atlasId === "ash-waste-scenery" && layer.cell === proof.companionSupportCell
    ));
    const targetPlacement = ashPlacementScene.visibleStaticLayers.find((layer) => (
      layer.atlasId === "ash-waste-scenery" && layer.cell === cell
    ));
    assert.ok(landmarkPlacement && companionPlacement && targetPlacement,
      `ash-waste/support/${cell}: scene connection placements missing`);
    assert.equal(targetPlacement.role, proof.role,
      `ash-waste/support/${cell}: preserved semantic placement role drift`);
    assert.deepEqual(
      AUTHORITY.clusterSupportsByLandmarkCell["ash-waste"][proof.landmarkCell],
      [proof.companionSupportCell, cell],
      `ash-waste/support/${cell}: literal landmark/support graph binding drift`,
    );
    const landmarkLayer = independentLayerRaw(landmarkPlacement, decoded);
    const supportLayers = [companionPlacement, targetPlacement]
      .map((placement) => independentLayerRaw(placement, decoded));
    const clusterScene = composeLayers(emptyRaw(), [
      ashRouteLayer,
      landmarkLayer,
      ...supportLayers,
    ]);
    assert.deepEqual(testOwnedClusterFailures({
      width: SCENE.width,
      height: SCENE.height,
      baseLayer: emptyRaw(),
      scene: clusterScene,
      landmarkLayer,
      supportLayers,
      routeLayer: ashRouteLayer,
    }, `ash-waste/legacy-support/${cell}/${proof.translatedRole}`), [],
    `ash-waste/support/${cell}: repaired infrastructure is not connected to its route/landmark cluster`);
  }
  const verticalAsh = ashCells.map(testOwnedLandmarkMaterialDepth).filter((metrics) => (
    metrics.silhouetteHeight >= ash.minimumVerticalSpanPixels
      && metrics.groundContactPixels >= ash.minimumGroundContactPixels
  ));
  assert.ok(verticalAsh.length >= ash.minimumVerticalLandmarks,
    "ash-waste: containment pylons lack tall grounded industrial anatomy");

  const dry = AUTHORITY.visualStructure["dry-scrub"];
  const dryCells = Object.values(changedLandmarks["dry-scrub"]);
  const forbiddenDry = paletteColors("dry-scrub", dry.forbiddenForeignTokens);
  assert.equal(dryCells.reduce((sum, raw) => sum + countMask(maskForColors(raw, forbiddenDry)), 0), 0,
    "dry-scrub: basin contains forbidden water palette");
  const drySandstone = paletteColors("dry-scrub", ["sandstone"]);
  for (const [cell, raw] of Object.entries(changedLandmarks["dry-scrub"])) {
    assert.ok(countMask(maskForColors(raw, drySandstone)) >= dry.minimumSandstonePixelsPerLandmark,
      `dry-scrub/landmark/${cell}: broad sandstone anatomy missing`);
  }
  const directionalDry = dryCells.map(testOwnedLandmarkMaterialDepth).filter(({ silhouetteWidth, silhouetteHeight }) => (
    silhouetteWidth / Math.max(1, silhouetteHeight) >= dry.minimumHorizontalAspect
  ));
  assert.ok(directionalDry.length >= dry.minimumDirectionalLandmarks,
    "dry-scrub: basin lacks directional wind-cut horizontal silhouettes");
  for (const token of ["deadwood", "thorn"]) {
    assert.ok(dryCells.reduce((sum, raw) => sum + countMask(maskForColors(raw,
      paletteColors("dry-scrub", [token]))), 0) > 0, `dry-scrub: ${token} anatomy missing`);
  }

  const neutral = AUTHORITY.visualStructure["neutral-temperate"];
  const pond = changedLandmarks["neutral-temperate"][neutral.landmarkCell];
  const waterMask = maskForColors(pond, paletteColors("neutral-temperate", neutral.waterTokens));
  const rimMask = maskForColors(pond, paletteColors("neutral-temperate", neutral.rimTokens));
  const timberMask = maskForColors(pond, paletteColors("neutral-temperate", neutral.timberTokens));
  const treeMask = maskForColors(pond, paletteColors("neutral-temperate", neutral.treeTokens));
  const water = maskMetrics(waterMask, pond.width, pond.height);
  assert.ok(water.pixels >= neutral.minimumWaterPixels, "Neutral cell 1: decisive pond water mass missing");
  assert.ok(water.largest.width >= neutral.minimumWaterSpan[0]
    && water.largest.height >= neutral.minimumWaterSpan[1], "Neutral cell 1: pond span is too slight");
  assert.ok(water.largest.pixels / (water.largest.width * water.largest.height)
    <= neutral.maximumWaterBoundsCoverage, "Neutral cell 1: pond is a rectangular glyph");
  assert.ok(countMask(rimMask) >= neutral.minimumRimPixels
    && masksWithinDistance(rimMask, waterMask, pond.width, pond.height,
      neutral.maximumMaterialJoinDistancePixels), "Neutral cell 1: irregular stone rim is not joined to pond");
  assert.ok(countMask(timberMask) >= neutral.minimumTimberPixels
    && masksWithinDistance(timberMask, waterMask, pond.width, pond.height,
      neutral.maximumMaterialJoinDistancePixels), "Neutral cell 1: timber wash platform is not joined to pond");
  assert.ok(countMask(treeMask) >= neutral.minimumTreePixels,
    "Neutral cell 1: inhabited wash-place trees are missing");

  const frameLimits = AUTHORITY.visualStructure.shared.rectangularFrame;
  for (const kit of ["spring-terraces", "worn-heartland"]) {
    const portsByCell = new Map(PORTS.landmarkPorts[kit]);
    for (const [cell, raw] of Object.entries(changedLandmarks[kit])) {
      const frame = rectangularFrameMetrics(raw, portsByCell.get(Number(cell)));
      assert.ok(frame.perimeterOpaqueShare <= frameLimits.perimeterOpaqueShareMax
        && frame.uninterruptedEdgePixels <= frameLimits.uninterruptedEdgePixelsMax,
      `${kit}/landmark/${cell}: rectangular construction frame or glyph rail remains`);
      const contract = AUTHORITY.visualStructure[kit];
      const tokens = kit === "spring-terraces"
        ? [...contract.waterTokens, ...contract.materialTokens] : contract.materialTokens;
      const materialPixels = countMask(maskForColors(raw, paletteColors(kit, tokens)));
      const minimum = kit === "spring-terraces"
        ? contract.minimumMaterialPixelsPerLandmark : contract.minimumMaterialPixelsPerLandmark;
      assert.ok(materialPixels >= minimum, `${kit}/landmark/${cell}: regional material anatomy is too slight`);
      if (kit === "spring-terraces") {
        assert.ok(countMask(maskForColors(raw, paletteColors(kit, contract.waterTokens)))
          >= contract.minimumWaterPixelsPerLandmark,
        `${kit}/landmark/${cell}: wet habitat water continuity missing`);
      } else assert.ok(frame.transparentPerimeterPixels >= contract.minimumTransparentPerimeterPixels,
        `${kit}/landmark/${cell}: agrarian boundary lacks irregular openings`);
    }
  }
});

test("public V4 dynamic proof preserves sources, exact relocation, and coherent humans", {
  skip: API_SKIP,
}, async () => {
  const [built, input, result] = await Promise.all([
    v4Build(),
    v4DynamicInput(),
    v4DynamicScenes(),
  ]);
  const expectedPlacementDigest = canonicalDigest(AUTHORITY.dynamicPlacements);
  assert.deepEqual(built.dynamicPlacements, {
    ...AUTHORITY.dynamicPlacements,
    canonicalSha256: expectedPlacementDigest,
  });
  assert.equal(built.receipt.dynamicPlacementSha256, expectedPlacementDigest);
  assertExactKeys(result, [
    "schema",
    "atlasOnlyStatic",
    "published",
    "task6Ready",
    "staticGeneration",
    "staticIntegrationIdentitySha256",
    "placementSha256",
    "sourceNames",
    "scenes",
  ], "V4 dynamic public result");
  assert.equal(result.schema, "regional-r5-dynamic-presentation-scenes/v1");
  assert.equal(result.atlasOnlyStatic, true);
  assert.equal(result.staticGeneration, "v4");
  assert.equal(result.published, false);
  assert.equal(result.staticIntegrationIdentitySha256,
    input.staticScenes.trustedV4.integrationIdentitySha256,
  "dynamic public scene must bind the V4 integration/compositor identity");
  assert.equal(result.placementSha256, built.dynamicPlacements.canonicalSha256);
  assert.deepEqual(result.sourceNames, Object.keys(input.dynamicSourceBuffers).sort(compareText));
  assert.deepEqual(Object.keys(result.scenes).sort(compareText), KITS);
  assert.equal(result.task6Ready, false,
    "dynamic proof remains a witness candidate until exact hashes are separately frozen");
  const decodedSources = await decodedDynamicSources(input.dynamicSourceBuffers);
  for (const [name, raw] of Object.entries(decodedSources)) {
    assertCanonicalTransparency(raw, `${name}/dynamic-source`);
  }
  const canonicalHuman = buildCanonicalHuman(decodedSources);
  assert.equal(HUMAN.facing, "south");
  assert.equal(HUMAN.action, "idle");
  assert.equal(HUMAN.layers.find(({ atlasId }) => atlasId === "core-human-body-rigs").cellIndex, 1);
  assert.equal(HUMAN.layers.find(({ atlasId }) => atlasId === "core-human-face-planes").cellIndex, 0);

  for (const kit of KITS) {
    const literal = AUTHORITY.dynamicPlacements.scenes[kit];
    const scene = result.scenes[kit];
    const oracle = independentDynamicScene(input.staticScenes.scenes[kit].raw,
      decodedSources, kit, literal);
    assert.deepEqual([scene.raw.width, scene.raw.height, scene.raw.channels], [768, 512, 4]);
    assert.equal(scene.rgbaSha256, sha256(scene.raw.data));
    assert.deepEqual(scene.static, {
      rgbaSha256: input.staticScenes.scenes[kit].rgbaSha256,
      visibleLayerCount: 408,
      visibleLayerIds: input.staticScenes.scenes[kit].visibleStaticLayers.map(({ id }) => id),
    }, `${kit}: dynamic painter must bind the exact V4 static scene receipt`);
    assert.deepEqual(scene.raw.data, oracle.raw.data,
      `${kit}: public painter differs from independent static -> yard -> back -> shadows -> feet-sort -> front flatten`);
    assert.deepEqual(scene.painterOrder, [
      "static-atlas-only",
      "yard",
      "home-actor-back",
      "human-contact-shadows",
      "humans-feet-sorted",
      "home-actor-front",
    ]);
    assert.deepEqual(scene.dynamic.yard.placement, literal.yard);
    assert.equal(scene.dynamic.yard.patchRgbaSha256, sha256(oracle.yard.data));
    assert.equal(scene.dynamic.yard.provenance.pngSha256,
      sha256(input.dynamicSourceBuffers[`${kit}-home-yards`]));
    assert.equal(scene.dynamic.yard.provenance.sourceRgbaSha256, sha256(oracle.yard.data));
    assert.deepEqual(scene.dynamic.homeActor.placement, literal.homeActor);
    assert.equal(scene.dynamic.homeActor.backPatchRgbaSha256, sha256(oracle.home.back.data));
    assert.equal(scene.dynamic.homeActor.frontPatchRgbaSha256, sha256(oracle.maskedFront.data));
    assert.deepEqual(scene.dynamic.homeActor.backSourceLayers, oracle.home.sourceLayers.back);
    assert.deepEqual(scene.dynamic.homeActor.frontSourceLayers, oracle.home.sourceLayers.front);
    assert.equal(scene.dynamic.contactShadows.rgbaSha256, sha256(oracle.shadows.raw.data));
    assert.deepEqual(scene.dynamic.contactShadows.instances, oracle.shadows.instances);
    assert.deepEqual(scene.dynamic.contactShadows.provenance, {
      sourceKind: "mechanics-authority",
      geometry: SHADOW.geometry,
      rows: SHADOW.rows,
      anchor: SHADOW.anchor,
      colorToken: SHADOW.colorToken,
      colorRgba: [...hexRgb(REGIONAL_R5_PALETTES.shared[SHADOW.colorToken]), 255],
      authoritySha256: canonicalDigest({
        geometry: SHADOW.geometry,
        rows: SHADOW.rows,
        anchor: SHADOW.anchor,
        colorToken: SHADOW.colorToken,
        colorRgba: [...hexRgb(REGIONAL_R5_PALETTES.shared[SHADOW.colorToken]), 255],
      }),
    });
    assert.deepEqual(scene.dynamic.humans.map(({ placement }) => placement),
      [...literal.humans].sort((left, right) => (
        left.destination.y + HUMAN.feet.y - right.destination.y - HUMAN.feet.y
        || left.destination.x - right.destination.x || compareText(left.id, right.id)
      )));
    assert.deepEqual(
      [literal.homeActor.destination.x - literal.yard.destination.x,
        literal.homeActor.destination.y - literal.yard.destination.y],
      AUTHORITY.preservation.homeActorOffsetFromYard,
    );
    const shelter = literal.humans.find(({ role }) => role === "shelter-door");
    assert.ok(shelter, `${kit}: shelter-door proof human missing`);
    assert.deepEqual(
      [shelter.destination.x - literal.homeActor.destination.x,
        shelter.destination.y - literal.homeActor.destination.y],
      AUTHORITY.preservation.shelterDoorOffsetFromHome,
      `${kit}: exact door/apron witness drift`,
    );

    for (let left = 0; left < literal.humans.length; left += 1) {
      for (let right = left + 1; right < literal.humans.length; right += 1) {
        assert.equal(rectsOverlap(literal.humans[left].destination, literal.humans[right].destination), false,
          `${kit}: proof humans overlap`);
      }
    }
    for (const witness of scene.dynamic.humans) {
      assert.equal(witness.patchRgbaSha256, HUMAN.canonicalPatchSha256);
      assert.equal(witness.facePatchRgbaSha256, sha256(canonicalHuman.face.data));
      assert.equal(witness.sourceLayers.filter(({ atlasId }) => atlasId === "core-human-face-planes").length, 1,
        `${kit}/${witness.id}: exactly one synchronized face plane is required`);
      for (const expectedLayer of canonicalHuman.layers) {
        const actual = witness.sourceLayers.find(({ atlasId }) => atlasId === expectedLayer.atlasId);
        assert.ok(actual, `${kit}/${witness.id}: ${expectedLayer.atlasId} missing`);
        assert.equal(actual.pngSha256, expectedLayer.pngSha256);
        assert.equal(actual.cell, expectedLayer.cell,
          `${kit}/${witness.id}: directional body/face cell desynchronized`);
        assert.deepEqual(actual.sourceRect, expectedLayer.sourceRect);
        assert.equal(actual.sourceRgbaSha256, expectedLayer.sourceRgbaSha256);
      }
      const destination = witness.placement.destination;
      let finalHumanPixels = 0;
      for (let y = 0; y < canonicalHuman.raw.height; y += 1) {
        for (let x = 0; x < canonicalHuman.raw.width; x += 1) {
          const sourceOffset = (y * canonicalHuman.raw.width + x) * 4;
          if (canonicalHuman.raw.data[sourceOffset + 3] === 0) continue;
          const outputOffset = ((destination.y + y) * SCENE.width + destination.x + x) * 4;
          assert.deepEqual(
            scene.raw.data.subarray(outputOffset, outputOffset + 4),
            canonicalHuman.raw.data.subarray(sourceOffset, sourceOffset + 4),
            `${kit}/${witness.id}: final directional face/body differs from the one coherent human patch`,
          );
          finalHumanPixels += 1;
        }
      }
      assert.equal(finalHumanPixels, opaquePixels(canonicalHuman.raw),
        `${kit}/${witness.id}: incomplete or doubled human body`);
    }
  }
});

test("every full V4 body and shadow clears water, canopy, tall landmarks, and static objects", {
  skip: API_SKIP,
}, async () => {
  const [built, decoded, dynamicInput, dynamicResult] = await Promise.all([
    v4Build(),
    v4Build().then(({ masterBuffers }) => decodeMasters(masterBuffers)),
    v4DynamicInput(),
    v4DynamicScenes(),
  ]);
  const dynamicDecoded = await decodedDynamicSources(dynamicInput.dynamicSourceBuffers);
  const humanPatch = buildCanonicalHuman(dynamicDecoded).raw;
  for (const kit of KITS) {
    const masks = buildStaticMasks(kit, built, decoded);
    const placements = built.placements.scenes[kit];
    const water = new Uint8Array(SCENE.width * SCENE.height);
    for (let y = 0; y < SCENE.height; y += 1) for (let x = 0; x < SCENE.width; x += 1) {
      const cell = terrainCellAt(placements, x, y);
      if (cell >= 16 && cell <= 23) water[y * SCENE.width + x] = 1;
    }
    const literalHumans = AUTHORITY.dynamicPlacements.scenes[kit].humans;
    const instances = dynamicResult.scenes[kit].dynamic.contactShadows.instances;
    assert.equal(instances.length, 3);
    for (const human of literalHumans) {
      const shadow = shadowCoordinates(human);
      const bodyMask = new Uint8Array(SCENE.width * SCENE.height);
      for (let y = 0; y < humanPatch.height; y += 1) for (let x = 0; x < humanPatch.width; x += 1) {
        if (humanPatch.data[(y * humanPatch.width + x) * 4 + 3] === 0) continue;
        const sceneX = human.destination.x + x;
        const sceneY = human.destination.y + y;
        assert.ok(sceneX >= 0 && sceneY >= 0 && sceneX < SCENE.width && sceneY < SCENE.height,
          `${kit}/${human.id}: opaque body escapes scene`);
        bodyMask[sceneY * SCENE.width + sceneX] = 1;
      }
      assert.equal(countMask(bodyMask), opaquePixels(humanPatch),
        `${kit}/${human.id}: body mask is incomplete`);
      const shadowMask = new Uint8Array(bodyMask.length);
      for (const [x, y] of shadow.coordinates) shadowMask[y * SCENE.width + x] = 1;
      const instance = instances.find(({ humanId }) => humanId === human.id);
      assert.ok(instance, `${kit}/${human.id}: contact-shadow receipt missing`);
      assert.deepEqual(instance.feet, shadow.feet);
      assert.deepEqual(instance.origin, shadow.origin);
      assert.equal(instance.opaquePixels, 80);
      for (const [x, y] of shadow.coordinates) {
        const terrainCell = terrainCellAt(placements, x, y);
        assert.equal(isRegionalWalkable(terrainCell), true,
          `${kit}/${human.id}/${x},${y}: shadow is not on legal walkable material`);
        assert.equal(terrainCell >= 16 && terrainCell <= 23, false,
          `${kit}/${human.id}/${x},${y}: shadow overlaps water`);
        assert.equal(masks.canopy[y * SCENE.width + x], 0,
          `${kit}/${human.id}/${x},${y}: shadow overlaps canopy`);
        assert.equal(masks.tallLandmark[y * SCENE.width + x], 0,
          `${kit}/${human.id}/${x},${y}: shadow overlaps a tall landmark`);
      }
      for (const [label, hazard] of [
        ["water", water],
        ["canopy", masks.canopy],
        ["tall-object", masks.tallLandmark],
        ["any-static-object", masks.object],
      ]) {
        const bodyDistance = minimumManhattanDistance(bodyMask, hazard, SCENE.width, SCENE.height);
        const shadowDistance = minimumManhattanDistance(shadowMask, hazard, SCENE.width, SCENE.height);
        assert.ok(bodyDistance >= AUTHORITY.visualStructure.shared.collisionMinimumDistancePixels,
          `${kit}/${human.id}: full opaque body collides with ${label} (distance ${bodyDistance})`);
        assert.ok(shadowDistance >= AUTHORITY.visualStructure.shared.collisionMinimumDistancePixels,
          `${kit}/${human.id}: full contact shadow collides with ${label} (distance ${shadowDistance})`);
      }
      if (human.relocation) {
        const [originX, originY] = human.relocation.replaces;
        const candidates = [];
        for (let y = 0; y <= SCENE.height - human.destination.height; y += 1) {
          for (let x = 0; x <= SCENE.width - human.destination.width; x += 1) {
            const squaredDistance = (x - originX) ** 2 + (y - originY) ** 2;
            if (squaredDistance > human.relocation.squaredDistance) continue;
            const destination = { x, y, width: 48, height: 64 };
            if (!humanPlacementIsCollisionFree(destination, humanPatch, masks.object, water)) continue;
            candidates.push({
              destination,
              squaredDistance,
              manhattanDistance: Math.abs(x - originX) + Math.abs(y - originY),
            });
          }
        }
        candidates.sort((left, right) => left.squaredDistance - right.squaredDistance
          || left.manhattanDistance - right.manhattanDistance
          || left.destination.y - right.destination.y
          || left.destination.x - right.destination.x);
        assert.deepEqual(candidates[0], {
          destination: human.destination,
          squaredDistance: human.relocation.squaredDistance,
          manhattanDistance: human.relocation.manhattanDistance,
        }, `${kit}/${human.id}: relocation is not the independently derived nearest legal coordinate`);
      }
    }
  }
});

test("V4 HomeActors clear static objects and yards join only legal regional material", {
  skip: API_SKIP,
}, async () => {
  const [built, decoded, input] = await Promise.all([
    v4Build(),
    v4Build().then(({ masterBuffers }) => decodeMasters(masterBuffers)),
    v4DynamicInput(),
  ]);
  const decodedSources = await decodedDynamicSources(input.dynamicSourceBuffers);
  for (const kit of KITS) {
    const literal = AUTHORITY.dynamicPlacements.scenes[kit];
    const staticPlacements = built.placements.scenes[kit];
    const masks = buildStaticMasks(kit, built, decoded);
    const homeLayers = buildHomeActor(decodedSources, kit);
    const home = composeLayers(emptyRaw(128, 128), [homeLayers.back, homeLayers.front]);
    for (let y = 0; y < home.height; y += 1) for (let x = 0; x < home.width; x += 1) {
      if (home.data[(y * home.width + x) * 4 + 3] === 0) continue;
      const sceneX = literal.homeActor.destination.x + x;
      const sceneY = literal.homeActor.destination.y + y;
      assert.equal(masks.object[sceneY * SCENE.width + sceneX], 0,
        `${kit}: HomeActor overlaps static landmark/support at ${sceneX},${sceneY}`);
    }

    const yard = rawCell(decoded[`${kit}-home-yards`], `${kit}-home-yards`, literal.yard.cell);
    const yardOpaque = [];
    for (let y = 0; y < yard.height; y += 1) for (let x = 0; x < yard.width; x += 1) {
      if (yard.data[(y * yard.width + x) * 4 + 3] === 0) continue;
      const sceneX = literal.yard.destination.x + x;
      const sceneY = literal.yard.destination.y + y;
      const terrainCell = terrainCellAt(staticPlacements, sceneX, sceneY);
      assert.equal(isRegionalWalkable(terrainCell), true,
        `${kit}: yard overlaps water/shore instead of terrain/route at ${sceneX},${sceneY}`);
      assert.equal(masks.object[sceneY * SCENE.width + sceneX], 0,
        `${kit}: yard overlaps static landmark/support at ${sceneX},${sceneY}`);
      yardOpaque.push([sceneX, sceneY]);
    }
    assert.ok(yardOpaque.length > 0, `${kit}: yard must have visible material`);
    const routeContact = yardOpaque.some(([x, y]) => {
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
        const candidateX = x + dx;
        const candidateY = y + dy;
        if (candidateX < 0 || candidateY < 0
            || candidateX >= SCENE.width || candidateY >= SCENE.height) continue;
        const cell = terrainCellAt(staticPlacements, candidateX, candidateY);
        if (cell >= 8 && cell <= 15) return true;
      }
      return false;
    });
    assert.equal(routeContact, true, `${kit}: yard must contact its route within two pixels`);

    const groundingMasks = buildExplicitGroundingMasks(
      kit,
      input.staticScenes.scenes[kit].raw,
      yard,
      literal.yard.destination,
      masks.object,
    );
    const sideWindows = ["top", "right", "bottom", "left"].map((side) => ({
      side,
      ...sideHasTwelvePixelMaterialWindow(side, literal.homeActor.destination, groundingMasks),
    }));
    const materialSides = sideWindows.filter(({ visible }) => visible);
    assert.ok(materialSides.length >= AUTHORITY.visualStructure.shared.homeGrounding.minimumSides,
      `${kit}: explicit yard/footing/regional-material mask must ground 12px on three HomeActor sides`);
    assert.ok(materialSides.filter(({ containsYardDelta }) => containsYardDelta).length
      >= AUTHORITY.visualStructure.shared.homeGrounding.minimumYardDeltaSides,
    `${kit}: at least one grounded side must visibly contain the decoded yard delta`);
  }
});

function freshStaticInput(built) {
  return {
    masterBuffers: cloneAcceptedValue(built.masterBuffers),
    placements: cloneAcceptedValue(built.placements),
    authoringIdentity: cloneAcceptedValue(built.authoringIdentity),
  };
}

async function freshDynamicInput() {
  return cloneAcceptedValue(await v4DynamicInput());
}

async function v4PostCallSnapshotContract(first, expectedStatic, expectedDynamic) {
  const failures = [];
  const expectedBuild = describeBuildResult(first);
  const builderCases = [
    {
      label: "builder authority wrapper replacement",
      mutate(input) { input.authority = { schema: "changed-after-call" }; },
    },
    {
      label: "builder nested authority mutation",
      mutate(input) {
        input.authority.dynamicPlacements.scenes["ash-waste"].humans[1].destination.x = 0;
      },
    },
  ];
  for (const contractCase of builderCases) {
    await recordContractCase(failures, contractCase.label, async () => {
      const input = { authority: structuredCloneJson(AUTHORITY) };
      const operation = productionPacker[API](input).then(describeBuildResult);
      contractCase.mutate(input);
      await assertExactResolution(operation, expectedBuild, contractCase.label);
    });
  }

  const staticAtlasId = "worn-heartland-terrain";
  const staticCases = [
    {
      label: "static master inventory replacement",
      mutate(input) { input.masterBuffers = {}; },
    },
    {
      label: "static master Buffer replacement",
      mutate(input) {
        input.masterBuffers[staticAtlasId] = Buffer.from(input.masterBuffers["dry-scrub-terrain"]);
      },
    },
    {
      label: "static master Buffer in-place mutation",
      mutate(input) { input.masterBuffers[staticAtlasId][0] ^= 1; },
    },
    {
      label: "static master Buffer backing-store transfer",
      prepare(input) {
        const transferred = transferableBuffer(input.masterBuffers[staticAtlasId]);
        input.masterBuffers[staticAtlasId] = transferred.buffer;
        return transferred;
      },
      mutate(_input, transferred) {
        structuredClone(transferred.backing, { transfer: [transferred.backing] });
      },
    },
    {
      label: "static placement mutation",
      mutate(input) {
        input.placements.scenes["worn-heartland"].visibleStaticLayers[0].destination.x += 32;
      },
    },
    {
      label: "static authoring identity mutation",
      mutate(input) { input.authoringIdentity.receiptSha256 = "0".repeat(64); },
    },
  ];
  for (const contractCase of staticCases) {
    await recordContractCase(failures, contractCase.label, async () => {
      const input = freshStaticInput(first);
      const prepared = contractCase.prepare?.(input);
      const operation = productionPacker[AUTHORITY.publicApis.staticCompositor](input)
        .then(describeStaticScenes);
      contractCase.mutate(input, prepared);
      await assertExactResolution(operation, expectedStatic, contractCase.label);
    });
  }

  const dynamicSourceId = "worn-heartland-home-yards";
  const dynamicCases = [
    {
      label: "dynamic static-scene Buffer replacement",
      mutate(input) {
        input.staticScenes.scenes["worn-heartland"].raw.data = Buffer.from(
          input.staticScenes.scenes["ash-waste"].raw.data,
        );
      },
    },
    {
      label: "dynamic static-scene Buffer in-place mutation",
      mutate(input) { input.staticScenes.scenes["worn-heartland"].raw.data[0] ^= 1; },
    },
    {
      label: "dynamic static-scene Buffer backing-store transfer",
      prepare(input) {
        const transferred = transferableBuffer(
          input.staticScenes.scenes["worn-heartland"].raw.data,
        );
        input.staticScenes.scenes["worn-heartland"].raw.data = transferred.buffer;
        return transferred;
      },
      mutate(_input, transferred) {
        structuredClone(transferred.backing, { transfer: [transferred.backing] });
      },
    },
    {
      label: "dynamic source Buffer replacement",
      mutate(input) {
        input.dynamicSourceBuffers[dynamicSourceId] = Buffer.from(
          input.dynamicSourceBuffers["dry-scrub-home-yards"],
        );
      },
    },
    {
      label: "dynamic source Buffer in-place mutation",
      mutate(input) { input.dynamicSourceBuffers[dynamicSourceId][0] ^= 1; },
    },
    {
      label: "dynamic source Buffer backing-store transfer",
      prepare(input) {
        const transferred = transferableBuffer(input.dynamicSourceBuffers[dynamicSourceId]);
        input.dynamicSourceBuffers[dynamicSourceId] = transferred.buffer;
        return transferred;
      },
      mutate(_input, transferred) {
        structuredClone(transferred.backing, { transfer: [transferred.backing] });
      },
    },
    {
      label: "dynamic placement mutation",
      mutate(input) {
        input.placements.scenes["worn-heartland"].humans[0].destination.x += 1;
      },
    },
  ];
  for (const contractCase of dynamicCases) {
    await recordContractCase(failures, contractCase.label, async () => {
      const input = await freshDynamicInput();
      const prepared = contractCase.prepare?.(input);
      const operation = productionPacker[AUTHORITY.publicApis.dynamicCompositor](input)
        .then(describeDynamicScenes);
      contractCase.mutate(input, prepared);
      await assertExactResolution(operation, expectedDynamic, contractCase.label);
    });
  }
  assertNoContractFailures(failures, "V4 public synchronous snapshot matrix");
}

async function v4RecursiveClosureSurfaceContract({ api, input, proxyPaths, surface }) {
  const synchronous = surface === "builder";
  const records = assertPinnedContainerInventory(surface, input);
  const indexedRecords = records.map((record, originalIndex) => ({ originalIndex, record }));
  const rootRecord = records.find(({ path }) => path === "<root>");
  assert.ok(rootRecord, `${surface}: explicit root probes require the pinned root container`);
  let containerProbeCount = 0;
  let rootAccessorProbeCount = 0;
  let rootProxyProbeCount = 0;
  let proxyProbeCount = 0;
  {
    rootAccessorProbeCount += 1;
    const label = `${surface}/<root>/explicit-accepted-field-accessor`;
    const probe = closureProbeSpine(records, rootRecord);
    const attack = installContainerAttack(
      probe.root,
      rootRecord,
      "accepted-field-accessor",
      label,
    );
    try {
      assertSharedIntakeRejectsAtPath(probe.root, attack.expectedIntakePath, label);
      if (synchronous) assertSynchronousTypeError(() => api(probe.root), label);
      else await assertMappedAsyncBoundaryRejects(
        api(probe.root), mappedBoundaryCode(surface, rootRecord.steps), label,
      );
    } finally {
      attack.restore();
    }
    assert.equal(attack.accessorReads(), 0,
      `${label}: descriptor-first rejection must not execute the root-field getter`);
  }
  {
    rootProxyProbeCount += 1;
    const label = `${surface}/<root>/stateful-Proxy`;
    const probe = closureProbeSpine(records, rootRecord);
    const attack = statefulTrapProxy(probe.root);
    assertSharedIntakeRejectsAtPath(attack.proxy, [], `${label}/shared-intake`);
    if (synchronous) assertSynchronousTypeError(() => api(attack.proxy), label);
    else await assertMappedAsyncBoundaryRejects(
      api(attack.proxy), mappedBoundaryCode(surface, []), label,
    );
    assert.deepEqual(attack.trapReads(), {
      get: 0,
      getOwnPropertyDescriptor: 0,
      getPrototypeOf: 0,
      has: 0,
      isExtensible: 0,
      ownKeys: 0,
    }, `${label}: rejection must execute no reflection or value traps`);
  }
  const distribution = Object.fromEntries(INTAKE_CLOSURE.representationOrder
    .map((representation) => [representation, 0]));
  let nestedAccessorSites = 0;
  for (const { originalIndex, record } of indexedRecords) {
    containerProbeCount += 1;
    const representation = deterministicRepresentation(record, originalIndex);
    distribution[representation] += 1;
    if (representation === "accepted-field-accessor" && record.steps.length > 1) {
      nestedAccessorSites += 1;
    }
    const label = `${surface}/${record.path}/${record.kind}/${representation}`;
    const probe = closureProbeSpine(records, record);
    const attack = installContainerAttack(probe.root, record, representation, label);
    try {
      assertSharedIntakeRejectsAtPath(probe.root, attack.expectedIntakePath, label);
      if (synchronous) assertSynchronousTypeError(() => api(probe.root), label);
      else await assertMappedAsyncBoundaryRejects(
        api(probe.root), mappedBoundaryCode(surface, record.steps), label,
      );
    } finally {
      attack.restore();
    }
    if (representation === "accepted-field-accessor") {
      assert.equal(attack.accessorReads(), 0,
        `${label}: descriptor-first rejection must not execute the accepted-field getter`);
    }
  }
  for (const representation of INTAKE_CLOSURE.representationOrder) {
    assert.ok(distribution[representation] > 0,
      `${surface}: deterministic distribution omitted ${representation}`);
  }
  assert.ok(nestedAccessorSites > 0,
    `${surface}: deterministic distribution omitted nested accepted-field accessors`);

  for (const path of proxyPaths) {
    proxyProbeCount += 1;
    const record = records.find((candidate) => candidate.path === path);
    assert.ok(record, `${surface}: pinned nested Proxy path missing (${path})`);
    const probe = closureProbeSpine(records, record);
    const attack = replaceNestedContainerWithProxy(probe.root, record.steps);
    const proxyLabel = `${surface}/${path}/stateful-Proxy`;
    try {
      assertSharedIntakeRejectsAtPath(
        probe.root,
        record.steps,
        `${proxyLabel}/shared-intake`,
      );
      if (synchronous) assertSynchronousTypeError(() => api(probe.root), proxyLabel);
      else await assertMappedAsyncBoundaryRejects(
        api(probe.root), mappedBoundaryCode(surface, record.steps),
        proxyLabel,
      );
    } finally {
      attack.restore();
    }
    assert.deepEqual(attack.trapReads(), {
      get: 0,
      getOwnPropertyDescriptor: 0,
      getPrototypeOf: 0,
      has: 0,
      isExtensible: 0,
      ownKeys: 0,
    }, `${surface}/${path}: descriptor-first Proxy rejection must execute no user traps`);
  }
  return {
    containerProbeCount,
    proxyProbeCount,
    rootAccessorProbeCount,
    rootProxyProbeCount,
  };
}

async function v4RecursiveClosureContract(first, parentTest) {
  const surfaces = [
    {
      api: (input) => productionPacker[API](input),
      input: { authority: structuredCloneJson(AUTHORITY) },
      proxyPaths: [
        "<root>/authority/dynamicPlacements/scenes/ash-waste/humans/0/destination",
        "<root>/authority/repairInventory/ash-waste/supports",
      ],
      surface: "builder",
    },
    {
      api: (input) => productionPacker[AUTHORITY.publicApis.staticCompositor](input),
      input: freshStaticInput(first),
      proxyPaths: [
        "<root>/placements/scenes/ash-waste/visibleStaticLayers/407/destination",
        "<root>/masterBuffers/ash-waste-terrain",
      ],
      surface: "staticCompositor",
    },
    {
      api: (input) => productionPacker[AUTHORITY.publicApis.dynamicCompositor](input),
      input: await freshDynamicInput(),
      proxyPaths: [
        "<root>/staticScenes/scenes/ash-waste/visibleStaticLayers/407/provenance",
        "<root>/dynamicSourceBuffers/core-human-body-rigs",
        "<root>/placements/scenes/ash-waste/humans/0/destination",
      ],
      surface: "dynamicCompositor",
    },
  ];
  let containerProbeCount = 0;
  let rootAccessorProbeCount = 0;
  let rootProxyProbeCount = 0;
  let proxyProbeCount = 0;
  for (const surfaceContract of surfaces) {
    let counts;
    await parentTest.test(
      `V4 recursive closure: ${surfaceContract.surface}`,
      async () => {
        counts = await v4RecursiveClosureSurfaceContract(surfaceContract);
      },
    );
    assert.ok(counts, `${surfaceContract.surface}: closure subtest did not return counts`);
    containerProbeCount += counts.containerProbeCount;
    rootAccessorProbeCount += counts.rootAccessorProbeCount;
    rootProxyProbeCount += counts.rootProxyProbeCount;
    proxyProbeCount += counts.proxyProbeCount;
  }
  assert.equal(containerProbeCount, INTAKE_CLOSURE.totalContainerProbeCount,
    "V4 closure matrix must attack every pinned concrete container exactly once");
  assert.equal(rootAccessorProbeCount, INTAKE_CLOSURE.rootAccessorProbeCount,
    "V4 closure matrix must execute one explicit root-field accessor proof per public boundary");
  assert.equal(rootProxyProbeCount, INTAKE_CLOSURE.rootProxyProbeCount,
    "V4 closure matrix must execute one explicit root Proxy proof per public boundary");
  assert.equal(proxyProbeCount, INTAKE_CLOSURE.nestedProxyProbeCount,
    "V4 closure matrix must execute every pinned nested Proxy proof exactly once");
  assert.equal(
    containerProbeCount + rootAccessorProbeCount + rootProxyProbeCount + proxyProbeCount,
    INTAKE_CLOSURE.maximumClosureProbeCount,
    "V4 closure matrix must exactly exhaust its literal deterministic probe budget",
  );
}

test("V4 public boundaries reject hidden pixels and caller mutation cannot poison later builds", {
  skip: API_SKIP,
}, async (t) => {
  const first = await productionPacker[API]({ authority: AUTHORITY });
  const staticScenes = await productionPacker[AUTHORITY.publicApis.staticCompositor]({
    masterBuffers: first.masterBuffers,
    placements: first.placements,
    authoringIdentity: first.authoringIdentity,
  });
  const dynamicBuffers = await dynamicSourceBuffers(first.masterBuffers);
  const expectedDynamic = describeDynamicScenes(
    await productionPacker[AUTHORITY.publicApis.dynamicCompositor]({
      staticScenes,
      dynamicSourceBuffers: dynamicBuffers,
      placements: first.dynamicPlacements,
    }),
  );
  await v4PostCallSnapshotContract(
    first,
    describeStaticScenes(staticScenes),
    expectedDynamic,
  );
  await v4RecursiveClosureContract(first, t);
  const surfaces = [
    ["builder", API, { authority: AUTHORITY }],
    ["staticCompositor", AUTHORITY.publicApis.staticCompositor, {
      masterBuffers: first.masterBuffers,
      placements: first.placements,
      authoringIdentity: first.authoringIdentity,
    }],
    ["dynamicCompositor", AUTHORITY.publicApis.dynamicCompositor, {
      staticScenes,
      dynamicSourceBuffers: dynamicBuffers,
      placements: first.dynamicPlacements,
    }],
  ];
  for (const [surface, api, base] of surfaces) {
    assert.deepEqual(Reflect.ownKeys(base).sort(compareText),
      [...AUTHORITY.closedInputKeys[surface]].sort(compareText));
    for (const representation of ["enumerable", "non-enumerable", "symbol"]) {
      for (const key of AUTHORITY.forbiddenCallerKeys) {
        await assert.rejects(
          async () => productionPacker[api](hostileInput(base, representation, key)),
          `${surface}/${representation}/${key}: hidden/direct caller data must reject`,
        );
      }
    }
  }

  const pristine = Object.fromEntries(MASTER_NAMES.map((name) => [
    name,
    Buffer.from(first.masterBuffers[name]),
  ]));
  first.masterBuffers["neutral-temperate-landmarks"][10] ^= 0xff;
  await assert.rejects(async () => productionPacker[AUTHORITY.publicApis.staticCompositor]({
    masterBuffers: first.masterBuffers,
    placements: first.placements,
    authoringIdentity: first.authoringIdentity,
  }), "mutated returned V4 PNG must reject at the real compositor");

  const second = await productionPacker[API]({ authority: AUTHORITY });
  for (const name of MASTER_NAMES) {
    assert.notStrictEqual(second.masterBuffers[name], first.masterBuffers[name],
      `${name}: later V4 result must not alias earlier caller-owned buffers`);
    assert.deepEqual(second.masterBuffers[name], pristine[name],
      `${name}: caller mutation poisoned deterministic V4 output`);
  }
  assert.notStrictEqual(second.masterBuffers, first.masterBuffers);
  assert.notStrictEqual(second.placements, first.placements);
  assert.notStrictEqual(second.dynamicPlacements, first.dynamicPlacements);
  assert.equal(second.authoringIdentity.releaseApproval, false);
  assert.equal(second.authoringIdentity.task6Ready, false);
  assert.equal(second.authoringIdentity.trustedWitness, null);
});
