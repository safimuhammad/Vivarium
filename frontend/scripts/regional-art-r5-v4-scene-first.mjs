/** Deterministic, bounded V4 scene-first reauthor over immutable V3 masters. */

import { createHash } from "node:crypto";

import sharp from "sharp";

import { REGIONAL_R5_PALETTES } from "./regional-art-r5-authoring-spec.mjs";
import {
  REGIONAL_R5_V4_AUTHORITY_SHA256,
  REGIONAL_R5_V4_DYNAMIC_PLACEMENTS,
  REGIONAL_R5_V4_KITS,
  REGIONAL_R5_V4_PREDECESSOR_MASTER_SHA256,
  REGIONAL_R5_V4_REPAIR_INVENTORY,
} from "./regional-art-r5-v4-scene-first-spec.mjs";

const FAMILIES = Object.freeze(["terrain", "scenery", "landmarks", "home-yards"]);
const GEOMETRY = Object.freeze({
  terrain: Object.freeze({ width: 256, height: 256, cellWidth: 32, cellHeight: 32 }),
  scenery: Object.freeze({ width: 512, height: 256, cellWidth: 32, cellHeight: 32 }),
  landmarks: Object.freeze({ width: 512, height: 256, cellWidth: 128, cellHeight: 128 }),
  "home-yards": Object.freeze({ width: 960, height: 160, cellWidth: 192, cellHeight: 160 }),
});
const MASTER_NAMES = Object.freeze(REGIONAL_R5_V4_KITS
  .flatMap((kit) => FAMILIES.map((family) => `${kit}-${family}`)).sort(compareText));
const OUTLINE = "outline";
const PROGRAM_SCHEMA = "regional-r5-v4-cell-repair-program/v1";
const RESULT_SCHEMA = "regional-r5-v4-scene-first-masters/v1";

let registeredTrust = null;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Buffer.isBuffer(value)
      || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

function detachedFrozen(value) {
  return deepFreeze(structuredClone(value));
}

function kitForAtlas(atlasId) {
  return REGIONAL_R5_V4_KITS.find((kit) => atlasId.startsWith(`${kit}-`));
}

function familyForAtlas(atlasId) {
  return FAMILIES.find((family) => atlasId.endsWith(`-${family}`));
}

function paletteRgba(kit, token) {
  const value = token === OUTLINE ? REGIONAL_R5_PALETTES.outline.source
    : REGIONAL_R5_PALETTES.kits[kit]?.[token] ?? REGIONAL_R5_PALETTES.shared[token];
  if (!value) throw new Error(`${kit}/${token}: V4 palette token missing`);
  return [1, 3, 5].map((start) => Number.parseInt(value.slice(start, start + 2), 16)).concat(255);
}

function assertProductionAuthority(authority) {
  if (canonicalDigest(authority) !== REGIONAL_R5_V4_AUTHORITY_SHA256) {
    throw new TypeError("V4 scene-first authority is missing, extra, or altered");
  }
  if (canonicalJson(authority.predecessor?.masterPngSha256)
      !== canonicalJson(REGIONAL_R5_V4_PREDECESSOR_MASTER_SHA256)) {
    throw new TypeError("V4 predecessor master authority drifted");
  }
  for (const kit of REGIONAL_R5_V4_KITS) {
    const actual = authority.repairInventory?.[kit];
    const expected = REGIONAL_R5_V4_REPAIR_INVENTORY[kit];
    if (canonicalJson(actual?.landmarks?.map(({ cell, role }) => [cell, role]))
          !== canonicalJson(expected.landmarks)
        || canonicalJson(actual?.supports?.map(({ cell, role }) => [cell, role]))
          !== canonicalJson(expected.supports)) {
      throw new TypeError(`${kit}: V4 repair inventory drifted`);
    }
    const scene = authority.dynamicPlacements?.scenes?.[kit];
    const [[yardX, yardY], humans] = REGIONAL_R5_V4_DYNAMIC_PLACEMENTS[kit];
    if (scene?.yard?.destination?.x !== yardX || scene?.yard?.destination?.y !== yardY
        || canonicalJson(scene?.humans?.map(({ destination }) => [destination.x, destination.y]))
          !== canonicalJson(humans)) {
      throw new TypeError(`${kit}: V4 dynamic placement authority drifted`);
    }
  }
}

function assertPredecessor(predecessor, portReceipt, integrationIdentity) {
  if (predecessor?.schema !== "regional-r5-v3-atomic-source-masters/v1"
      || predecessor.authoringIdentity?.canonicalSha256
        !== canonicalDigest(Object.fromEntries(Object.entries(predecessor.authoringIdentity)
          .filter(([key]) => key !== "canonicalSha256")))
      || predecessor.receipt?.landmarkPortReceiptSha256 !== portReceipt?.canonicalSha256
      || integrationIdentity?.generation !== "v3") {
    throw new Error("V4 requires the self-authenticating V3 predecessor chain");
  }
  for (const name of MASTER_NAMES) {
    if (!Buffer.isBuffer(predecessor.masterBuffers?.[name])
        || sha256(predecessor.masterBuffers[name]) !== REGIONAL_R5_V4_PREDECESSOR_MASTER_SHA256[name]) {
      throw new Error(`${name}: immutable V3 predecessor bytes drifted`);
    }
  }
}

async function decodeMaster(bytes, atlasId) {
  const family = familyForAtlas(atlasId);
  const geometry = GEOMETRY[family];
  const { data, info } = await sharp(bytes).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== geometry.width || info.height !== geometry.height || info.channels !== 4) {
    throw new Error(`${atlasId}: V3 predecessor geometry drifted`);
  }
  return { data: Buffer.from(data), width: info.width, height: info.height, channels: 4 };
}

function rawCell(master, family, cell) {
  const geometry = GEOMETRY[family];
  const columns = geometry.width / geometry.cellWidth;
  const left = cell % columns * geometry.cellWidth;
  const top = Math.floor(cell / columns) * geometry.cellHeight;
  const data = Buffer.alloc(geometry.cellWidth * geometry.cellHeight * 4);
  for (let row = 0; row < geometry.cellHeight; row += 1) {
    const start = ((top + row) * master.width + left) * 4;
    master.data.copy(data, row * geometry.cellWidth * 4, start,
      start + geometry.cellWidth * 4);
  }
  return { data, width: geometry.cellWidth, height: geometry.cellHeight, channels: 4 };
}

function replaceCell(master, family, cell, source) {
  const geometry = GEOMETRY[family];
  const columns = geometry.width / geometry.cellWidth;
  const left = cell % columns * geometry.cellWidth;
  const top = Math.floor(cell / columns) * geometry.cellHeight;
  for (let row = 0; row < source.height; row += 1) {
    source.data.copy(master.data, ((top + row) * master.width + left) * 4,
      row * source.width * 4, (row + 1) * source.width * 4);
  }
}

function setPixel(raw, x, y, rgba) {
  if (x < 0 || y < 0 || x >= raw.width || y >= raw.height) return;
  raw.data.set(rgba, (y * raw.width + x) * 4);
}

function fillRect(raw, rect, rgba) {
  const [x, y, width, height] = rect;
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) setPixel(raw, column, row, rgba);
  }
}

function applyOperation(raw, kit, operation, predecessor) {
  if (operation.kind === "alpha-over-source") {
    predecessor.data.copy(raw.data);
    return;
  }
  if (operation.kind === "clear-rect") {
    fillRect(raw, operation.rect, [0, 0, 0, 0]);
    return;
  }
  const rgba = paletteRgba(kit, operation.paletteToken);
  if (operation.kind === "fill-rect") fillRect(raw, operation.rect, rgba);
  else if (operation.kind === "fill-horizontal-run") {
    fillRect(raw, [operation.x, operation.y, operation.length, operation.thickness], rgba);
  } else if (operation.kind === "fill-vertical-run") {
    fillRect(raw, [operation.x, operation.y, operation.thickness, operation.length], rgba);
  } else if (operation.kind === "fill-ellipse") {
    const [x, y, width, height] = operation.bounds;
    for (let row = y; row < y + height; row += 1) for (let column = x; column < x + width; column += 1) {
      const dx = (column + 0.5 - x - width / 2) / (width / 2);
      const dy = (row + 0.5 - y - height / 2) / (height / 2);
      if (dx * dx + dy * dy <= 1) setPixel(raw, column, row, rgba);
    }
  } else if (operation.kind === "stroke-polyline") {
    for (let index = 1; index < operation.points.length; index += 1) {
      let [x0, y0] = operation.points[index - 1];
      const [x1, y1] = operation.points[index];
      const dx = Math.abs(x1 - x0); const sx = x0 < x1 ? 1 : -1;
      const dy = -Math.abs(y1 - y0); const sy = y0 < y1 ? 1 : -1;
      let error = dx + dy;
      for (;;) {
        fillRect(raw, [x0 - Math.floor(operation.thickness / 2),
          y0 - Math.floor(operation.thickness / 2), operation.thickness, operation.thickness], rgba);
        if (x0 === x1 && y0 === y1) break;
        const doubled = 2 * error;
        if (doubled >= dy) { error += dy; x0 += sx; }
        if (doubled <= dx) { error += dx; y0 += sy; }
      }
    }
  }
}

const alpha = () => ({ kind: "alpha-over-source", sourceIndex: 0 });
const clear = (rect) => ({ kind: "clear-rect", rect });
const rect = (rectValue, paletteToken) => ({ kind: "fill-rect", rect: rectValue, paletteToken });
const ellipse = (bounds, paletteToken) => ({ kind: "fill-ellipse", bounds, paletteToken });
const horizontal = (x, y, length, thickness, paletteToken) => (
  { kind: "fill-horizontal-run", x, y, length, thickness, paletteToken }
);
const vertical = (x, y, length, thickness, paletteToken) => (
  { kind: "fill-vertical-run", x, y, length, thickness, paletteToken }
);
const stroke = (points, thickness, paletteToken) => (
  { kind: "stroke-polyline", points, thickness, paletteToken }
);

function terrainOperations(kit, cell) {
  const tokens = {
    "ash-waste": ["charcoal", "plum-ash", "slag"],
    "dry-scrub": ["ochre-mid", "sandstone", "ochre-dark"],
    "neutral-temperate": ["sage-mid", "damp-verge", "blue-green"],
    "spring-terraces": ["mint-mid", "reed", "mineral-stone"],
    "worn-heartland": ["olive-mid", "olive-light", "ochre-earth"],
  }[kit];
  const variant = cell - 4;
  const operations = [alpha(), clear([0, 0, 32, 32]), rect([0, 0, 32, 32], tokens[0])];
  for (let index = 0; index < 36; index += 1) {
    const x = (index * 17 + variant * 7 + Math.floor(index / 6) * 3) % 30;
    const y = (index * 11 + variant * 13 + (index % 5) * 4) % 30;
    operations.push(rect([x, y, 2, 2], tokens[1 + ((index + variant) % 2)]));
  }
  operations.push(stroke([[2, 26 - variant * 2], [10, 23 - variant], [18, 25], [29, 20 + variant]],
    1 + (variant % 2), tokens[(variant + 1) % tokens.length]));
  return operations;
}

function landmarkCoreOperations(kit, cell) {
  const operations = [alpha(), clear([0, 0, 128, 128])];
  if (kit === "ash-waste") {
    operations.push(
      ellipse([13, 32, 102, 76], "oxidized-metal"),
      rect([26, 49, 76, 57], "containment-concrete"),
      vertical(48 + cell % 2 * 20, 12, 101, 13, "plum-ash"),
      horizontal(20, 82, 88, 9, "slag"),
      horizontal(30, 58, 68, 5, "warning-ochre"),
      rect([42, 25, 13, 16], "hazard-lime"),
      horizontal(38, 123, 52, 4, "containment-concrete"),
    );
  } else if (kit === "dry-scrub") {
    operations.push(
      ellipse([8, 38, 112, 62], "sandstone"),
      horizontal(14, 65, 100, 17, "ochre-mid"),
      stroke([[15, 76], [38, 54], [63, 69], [90, 47], [113, 60]], 7, "deadwood"),
      stroke([[22, 91], [46, 72], [71, 88], [105, 71]], 5, "thorn"),
      horizontal(30, 103, 68, 8, "sand-light"),
      horizontal(40, 123, 48, 4, "sandstone"),
    );
  } else if (kit === "neutral-temperate") {
    operations.push(
      ellipse([21, 51, 86, 48], "stone-shadow"),
      ellipse([27, 54, 74, 40], "pond-deep"),
      ellipse([34, 58, 60, 31], "pond-light"),
      horizontal(18, 94, 94, 7, "field-stone"),
      rect([71, 69, 38, 12], "meadow-timber"),
      vertical(96, 55, 38, 8, "meadow-timber"),
      ellipse([9, 20, 39, 58], "hedge-deep"),
      ellipse([18, 13, 42, 57], "sage-dark"),
      ellipse([88, 20, 31, 50], "hedge-deep"),
      horizontal(42, 123, 46, 4, "field-stone"),
    );
  } else if (kit === "spring-terraces") {
    operations.push(
      ellipse([13, 38, 102, 65], "deep-aqua"),
      stroke([[15, 69], [42, 54], [68, 72], [108, 48]], 8, "shallow-aqua"),
      horizontal(18, 78, 91, 8, "mineral-stone"),
      stroke([[24, 91], [49, 80], [77, 91], [104, 73]], 7, "wet-timber"),
      vertical(32, 54, 51, 6, "reed"),
      horizontal(38, 123, 54, 4, "mineral-stone"),
    );
  } else {
    operations.push(
      ellipse([11, 38, 106, 66], "ochre-earth"),
      stroke([[16, 88], [40, 55], [66, 76], [93, 49], [112, 70]], 8, "timber"),
      horizontal(19, 81, 36, 8, "worn-beige"),
      horizontal(72, 91, 36, 7, "olive-dark"),
      rect([34, 47, 16, 13], "faded-flower"),
      rect([86, 61, 17, 12], "olive-light"),
      horizontal(41, 123, 46, 4, "ochre-earth"),
    );
  }
  operations.push(vertical(30, 100, 27, 8,
    kit === "ash-waste" ? "containment-concrete"
      : kit === "dry-scrub" ? "sandstone"
        : kit === "neutral-temperate" ? "field-stone"
          : kit === "spring-terraces" ? "mineral-stone" : "ochre-earth"));
  if (kit === "dry-scrub") operations.push(vertical(64, 90, 37, 8, "sandstone"));
  if (kit === "dry-scrub" && cell === 4) {
    operations.push(vertical(54, 28, 11, 2, "deadwood"));
  }
  if (kit === "worn-heartland" && cell === 3) {
    operations.push(vertical(57, 15, 24, 2, "timber"));
  }
  if (kit === "worn-heartland") {
    operations.push(horizontal(37, 123, 5, 4, "ochre-earth"));
  }
  return operations;
}

function appendExactPorts(operations, edgeAlphaSpans, paletteToken) {
  const seen = new Set();
  const append = (operation) => {
    const key = canonicalJson(operation);
    if (!seen.has(key)) { seen.add(key); operations.push(operation); }
  };
  for (const [direction, spans] of Object.entries(edgeAlphaSpans)) {
    for (const [start, end] of spans) {
      const length = end - start + 1;
      const midpoint = Math.floor((start + end) / 2);
      const inner = direction === "n" ? [midpoint, 2]
        : direction === "s" ? [midpoint, 125]
          : direction === "w" ? [2, midpoint] : [125, midpoint];
      append(stroke([inner, [64, 70]], 2, paletteToken));
      if (direction === "n") append(vertical(midpoint, 0, 3, 1, paletteToken));
      else if (direction === "s") append(vertical(midpoint, 125, 3, 1, paletteToken));
      else if (direction === "w") append(horizontal(0, midpoint, 3, 1, paletteToken));
      else append(horizontal(125, midpoint, 3, 1, paletteToken));
      if (direction === "n") append(horizontal(start, 0, length, 1, paletteToken));
      else if (direction === "s") append(horizontal(start, 127, length, 1, paletteToken));
      else if (direction === "w") append(vertical(0, start, length, 1, paletteToken));
      else append(vertical(127, start, length, 1, paletteToken));
    }
  }
}

function supportOperations(kit, cell) {
  const legacyAsh = kit === "ash-waste" && (cell === 3 || cell === 22);
  const yardClearance = kit === "worn-heartland" && cell === 5;
  const clusterRebuild = kit === "ash-waste" && (cell === 0 || cell === 1);
  const dryBasinCluster = kit === "dry-scrub" && (cell === 0 || cell === 4);
  const dryHumanClearance = kit === "dry-scrub" && cell === 5;
  const operations = [alpha(), ...(legacyAsh || yardClearance || clusterRebuild
    || dryBasinCluster || dryHumanClearance
    ? [clear([0, 0, 32, 32])] : [])];
  const tokens = {
    "ash-waste": ["containment-concrete", "oxidized-metal", "warning-ochre", "slag"],
    "dry-scrub": ["sandstone", "deadwood", "thorn", "ochre-mid"],
    "neutral-temperate": ["field-stone", "hedge-deep", "meadow-timber", "sage-dark"],
    "spring-terraces": ["mineral-stone", "deep-aqua", "wet-timber", "reed"],
    "worn-heartland": ["timber", "ochre-earth", "worn-beige", "olive-dark"],
  }[kit];
  if (legacyAsh) {
    operations.push(
      rect([1, 8, 30, 16], tokens[0]),
      horizontal(1, 12, 30, 7, tokens[1]),
      horizontal(3, 10, 24, 3, tokens[2]),
      horizontal(1, 22, 30, 5, tokens[3]),
      rect([5, 6, 8, 5], OUTLINE),
    );
  } else if (yardClearance) {
    operations.push(
      ellipse([1, 11, 13, 13], tokens[0]),
      rect([2, 18, 12, 6], tokens[1]),
      rect([5, 12, 7, 5], tokens[2]),
      vertical(1, 13, 11, 2, tokens[3]),
    );
  } else if (dryBasinCluster) {
    const bounds = cell === 0 ? [0, 22, 8, 8] : [24, 0, 8, 8];
    operations.push(
      rect(bounds, "sand-light"),
      horizontal(bounds[0], bounds[1] + 3, bounds[2], 3, OUTLINE),
      rect([bounds[0] + 2, bounds[1] + 1, 4, 2], tokens[3]),
    );
  } else if (dryHumanClearance) {
    operations.push(
      ellipse([17, 7, 14, 22], tokens[0]),
      vertical(23, 3, 27, 5, tokens[1]),
      stroke([[18, 24], [24, 14], [30, 20]], 3, tokens[2]),
      rect([18, 22, 12, 6], tokens[3]),
    );
  } else {
    const shift = cell % 5;
    operations.push(
      ellipse([3 + shift % 2, 10, 25, 16], tokens[0]),
      horizontal(4, 18, 24, 6, tokens[1]),
      stroke([[5, 20], [13, 11 + shift], [22, 18], [28, 9 + shift]], 3, tokens[2]),
      rect([9 + shift, 22, 12, 5], tokens[3]),
    );
  }
  if (kit === "dry-scrub" && cell === 8) {
    operations.push(rect([20, 0, 12, 12], "sandstone"));
  }
  return operations;
}

function changedPixelCount(before, after) {
  let count = 0;
  for (let offset = 0; offset < before.data.length; offset += 4) {
    if (!before.data.subarray(offset, offset + 4).equals(after.data.subarray(offset, offset + 4))) count += 1;
  }
  return count;
}

function sourceOperation(atlasId, family, cell, before) {
  const geometry = GEOMETRY[family];
  const columns = geometry.width / geometry.cellWidth;
  return {
    sourceId: `v3-master/${atlasId}/${cell}`,
    encodedMasterPngSha256: REGIONAL_R5_V4_PREDECESSOR_MASTER_SHA256[atlasId],
    sourceRgbaSha256: sha256(before.data),
    cropRect: [cell % columns * geometry.cellWidth,
      Math.floor(cell / columns) * geometry.cellHeight,
      geometry.cellWidth, geometry.cellHeight],
    destination: [0, 0],
  };
}

async function encodeRaw(raw) {
  return sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .png({ adaptiveFiltering: false, compressionLevel: 9, effort: 10, palette: false })
    .toBuffer();
}

function buildDynamicPlacements(authority) {
  const body = structuredClone(authority.dynamicPlacements);
  return deepFreeze({ ...body, canonicalSha256: canonicalDigest(body) });
}

function buildStaticPlacements(authority, predecessorPlacements) {
  const placements = structuredClone(predecessorPlacements);
  for (const override of authority.preservation.staticPlacementOverrides) {
    const layer = placements.scenes[override.kit].visibleStaticLayers
      .find(({ id }) => id === override.id);
    if (!layer || layer.atlasId !== override.atlasId || layer.cell !== override.cell
        || canonicalJson(layer.destination) !== canonicalJson(override.predecessorDestination)) {
      throw new Error(`${override.id}: V4 static override predecessor tuple drifted`);
    }
    layer.destination = structuredClone(override.destination);
  }
  const { canonicalSha256: _predecessorDigest, ...body } = placements;
  return deepFreeze({ ...body, canonicalSha256: canonicalDigest(body) });
}

function registerTrust(metadata) {
  const detached = detachedFrozen(metadata);
  if (registeredTrust !== null
      && canonicalJson(registeredTrust) !== canonicalJson(detached)) {
    throw new Error("V4 deterministic trust registration drifted between builds");
  }
  registeredTrust = detached;
}

/** Return the deterministic V4 integration identity after the V4 builder has run. */
export function regionalR5V4IntegrationIdentityInternal() {
  if (registeredTrust === null) throw new Error("V4 integration identity is unavailable before its builder runs");
  return structuredClone(registeredTrust.integrationIdentity);
}

/** Return detached internal trust metadata used by the production compositors. */
export function regionalR5V4RegisteredTrustInternal() {
  if (registeredTrust === null) throw new Error("V4 trust is unavailable before its builder runs");
  return structuredClone(registeredTrust);
}

/** Build the exact 89-cell V4 correction over a verified V3 predecessor. */
export async function buildRegionalR5V4SceneFirstMastersInternal({
  authority,
  predecessor,
  portReceipt,
  predecessorIntegrationIdentity,
}) {
  assertProductionAuthority(authority);
  assertPredecessor(predecessor, portReceipt, predecessorIntegrationIdentity);
  const masters = Object.fromEntries(await Promise.all(MASTER_NAMES.map(async (atlasId) => [
    atlasId,
    await decodeMaster(predecessor.masterBuffers[atlasId], atlasId),
  ])));
  const repairs = [];
  const portCells = new Map(portReceipt.cells.map(({ kit, cell, edgeAlphaSpans }) => (
    [`${kit}/${cell}`, edgeAlphaSpans]
  )));
  for (const kit of REGIONAL_R5_V4_KITS) {
    for (const cell of [4, 5, 6, 7]) {
      repairs.push({ atlasId: `${kit}-terrain`, family: "terrain", cell,
        role: `quiet-terrain-${cell}`, operations: terrainOperations(kit, cell) });
    }
    for (const [cell, role] of REGIONAL_R5_V4_REPAIR_INVENTORY[kit].landmarks) {
      const operations = landmarkCoreOperations(kit, cell);
      if (kit === "dry-scrub" && cell === 2) {
        operations.push(clear([0, 0, 20, 128]));
      }
      if (kit === "dry-scrub" && cell === 1) {
        operations.push(horizontal(1, 68, 17, 10, "sandstone"));
      }
      if (kit === "ash-waste" && cell === 2) {
        operations.push(clear([53, 118, 52, 9]));
        operations.push(horizontal(60, 112, 30, 6, "containment-concrete"));
        operations.push(horizontal(60, 117, 30, 3, "containment-concrete"));
        operations.push(rect([78, 120, 3, 1], "containment-concrete"));
      }
      appendExactPorts(operations, portCells.get(`${kit}/${cell}`),
        kit === "ash-waste" ? "containment-concrete"
          : kit === "dry-scrub" ? "sandstone"
            : kit === "neutral-temperate" ? "field-stone"
              : kit === "spring-terraces" ? "mineral-stone" : "ochre-earth");
      repairs.push({ atlasId: `${kit}-landmarks`, family: "landmarks", cell, role, operations });
    }
    for (const [cell, role] of REGIONAL_R5_V4_REPAIR_INVENTORY[kit].supports) {
      repairs.push({ atlasId: `${kit}-scenery`, family: "scenery", cell, role,
        operations: supportOperations(kit, cell) });
    }
  }
  if (repairs.length !== 89) throw new Error(`V4 repair inventory must contain 89 cells, got ${repairs.length}`);
  const receiptDrafts = [];
  for (const repair of repairs) {
    const kit = kitForAtlas(repair.atlasId);
    const before = rawCell(masters[repair.atlasId], repair.family, repair.cell);
    const after = { data: Buffer.alloc(before.data.length), width: before.width,
      height: before.height, channels: 4 };
    for (const operation of repair.operations) applyOperation(after, kit, operation, before);
    replaceCell(masters[repair.atlasId], repair.family, repair.cell, after);
    receiptDrafts.push({ ...repair, before, after });
  }
  const masterBuffers = {};
  const masterPngSha256 = {};
  for (const atlasId of MASTER_NAMES) {
    masterBuffers[atlasId] = await encodeRaw(masters[atlasId]);
    masterPngSha256[atlasId] = sha256(masterBuffers[atlasId]);
  }
  const repairedCells = receiptDrafts.map(({ atlasId, family, cell, role, operations, before, after }) => ({
    atlasId,
    cell,
    family,
    role,
    programSchema: PROGRAM_SCHEMA,
    beforeRgbaSha256: sha256(before.data),
    sourceOperations: [sourceOperation(atlasId, family, cell, before)],
    orderedOperations: operations,
    afterRgbaSha256: sha256(after.data),
    encodedMasterPngSha256: masterPngSha256[atlasId],
    changedPixels: changedPixelCount(before, after),
  }));
  const placements = buildStaticPlacements(authority, predecessor.placements);
  const dynamicPlacements = buildDynamicPlacements(authority);
  const receiptBody = {
    schema: "regional-r5-v4-scene-first-receipt/v1",
    authoritySha256: REGIONAL_R5_V4_AUTHORITY_SHA256,
    atomicIntakeReceiptSha256: predecessor.receipt.canonicalSha256,
    predecessorAuthoringIdentitySha256: predecessor.authoringIdentity.canonicalSha256,
    landmarkPortReceiptSha256: portReceipt.canonicalSha256,
    masterPngSha256,
    repairedCells,
    dynamicPlacementSha256: canonicalDigest(authority.dynamicPlacements),
  };
  const receipt = deepFreeze({ ...receiptBody, canonicalSha256: canonicalDigest(receiptBody) });
  const placementSha256 = canonicalDigest(placements);
  const authoringIdentityBody = {
    schema: "regional-r5-v4-authoring-identity/v1",
    generation: "v4",
    authoritySha256: REGIONAL_R5_V4_AUTHORITY_SHA256,
    receiptSha256: receipt.canonicalSha256,
    atomicIntakeReceiptSha256: predecessor.receipt.canonicalSha256,
    predecessorAuthoringIdentitySha256: predecessor.authoringIdentity.canonicalSha256,
    landmarkPortReceiptSha256: portReceipt.canonicalSha256,
    masterSetSha256: canonicalDigest(masterPngSha256),
    placementSha256,
    dynamicPlacementSha256: canonicalDigest(authority.dynamicPlacements),
    releaseApproval: false,
    task6Ready: false,
    trustedWitness: null,
  };
  const authoringIdentity = deepFreeze({
    ...authoringIdentityBody,
    canonicalSha256: canonicalDigest(authoringIdentityBody),
  });
  const integrationBody = {
    schema: "regional-r5-v4-integration-identity/v1",
    generation: "v4",
    predecessorIntegrationIdentitySha256: predecessorIntegrationIdentity.canonicalSha256,
    atomicIntakeReceiptSha256: predecessor.receipt.canonicalSha256,
    landmarkPortReceiptSha256: portReceipt.canonicalSha256,
    authoritySha256: REGIONAL_R5_V4_AUTHORITY_SHA256,
    receiptSha256: receipt.canonicalSha256,
    masterSetSha256: authoringIdentity.masterSetSha256,
    placementSha256: authoringIdentity.placementSha256,
    dynamicPlacementSha256: authoringIdentity.dynamicPlacementSha256,
    compositorIdentitySha256: predecessorIntegrationIdentity.compositorIdentitySha256,
  };
  const integrationIdentity = deepFreeze({
    ...integrationBody,
    canonicalSha256: canonicalDigest(integrationBody),
  });
  registerTrust({
    integrationIdentity,
    authoringIdentity,
    masterPngSha256,
    receipt,
    placementSha256,
    placements,
    dynamicPlacements,
  });
  return {
    schema: RESULT_SCHEMA,
    authority: detachedFrozen(authority),
    masterBuffers: Object.fromEntries(MASTER_NAMES.map((name) => [name, Buffer.from(masterBuffers[name])])),
    placements: structuredClone(placements),
    dynamicPlacements: structuredClone(dynamicPlacements),
    authoringIdentity: structuredClone(authoringIdentity),
    receipt: detachedFrozen(receipt),
  };
}
