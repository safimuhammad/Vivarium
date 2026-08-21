/**
 * RED contract for V3 landmark edge ports, terrain routes, and closed inputs.
 *
 * Every visual assertion is recomputed from encoded public-builder PNG bytes.
 * The production port receipt is checked against a separate literal authority;
 * it is never used to derive expected spans or route connectivity.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import sharp from "sharp";

import {
  REGIONAL_R5_A_PRIME_LITERAL_PLACEMENTS,
} from "./fixtures/regional-art-r5-atlas-only-literal-authority.mjs";
import {
  REGIONAL_R5_V3_ATOMIC_LITERAL_AUTHORITY,
} from "./fixtures/regional-art-r5-v3-atomic-literal-authority.mjs";
import {
  REGIONAL_R5_V3_PORTS_LITERAL_AUTHORITY,
  REGIONAL_R5_V3_PORTS_LITERAL_AUTHORITY_SHA256,
} from "./fixtures/regional-art-r5-v3-ports-literal-authority.mjs";
import * as productionPacker from "./pack-2d-production-assets.mjs";

const AUTHORITY = REGIONAL_R5_V3_PORTS_LITERAL_AUTHORITY;
const ATOMIC = REGIONAL_R5_V3_ATOMIC_LITERAL_AUTHORITY;
const KITS = Object.freeze(Object.keys(AUTHORITY.landmarkPorts));
const DIRECTIONS = Object.freeze({
  n: Object.freeze([0, -1]),
  e: Object.freeze([1, 0]),
  s: Object.freeze([0, 1]),
  w: Object.freeze([-1, 0]),
});
const DIRECTION_NAMES = Object.freeze(Object.keys(DIRECTIONS));

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

function parseRoute(path) {
  return path.split(" ").map((pair) => pair.split(",").map(Number));
}

function tileKey([x, y]) {
  return `${x},${y}`;
}

function directionFor(dx, dy) {
  return Object.entries(DIRECTIONS)
    .find(([_direction, [candidateX, candidateY]]) => candidateX === dx && candidateY === dy)?.[0];
}

function rawCell(raw, cellIndex, width, height, columns) {
  const left = (cellIndex % columns) * width;
  const top = Math.floor(cellIndex / columns) * height;
  const data = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    raw.data.copy(data, row * width * 4, ((top + row) * raw.width + left) * 4,
      ((top + row) * raw.width + left + width) * 4);
  }
  return { data, width, height, channels: 4 };
}

function rgbaAt(raw, x, y) {
  const offset = (y * raw.width + x) * 4;
  return [...raw.data.subarray(offset, offset + 4)];
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

function hostileInput(base, representation, name) {
  const input = { ...base };
  if (representation === "enumerable") input[name] = { forbidden: true };
  else if (representation === "non-enumerable") {
    Object.defineProperty(input, name, {
      configurable: true,
      enumerable: false,
      value: { forbidden: true },
    });
  } else {
    input[Symbol(name)] = { forbidden: true };
  }
  return input;
}

async function rejectsCall(call) {
  try {
    await call();
    return false;
  } catch {
    return true;
  }
}

let sharedBuildPromise;
function sharedBuild() {
  sharedBuildPromise ??= productionPacker[AUTHORITY.builderApi]({ authority: ATOMIC });
  return sharedBuildPromise;
}

async function strictnessReadiness() {
  const failures = [];
  if (typeof productionPacker[AUTHORITY.portReceiptApi] !== "function") {
    failures.push(`missing ${AUTHORITY.portReceiptApi}`);
  }
  if (typeof productionPacker[AUTHORITY.builderApi] !== "function") {
    failures.push(`missing ${AUTHORITY.builderApi}`);
    return failures;
  }
  if (typeof productionPacker[AUTHORITY.compositorApi] !== "function") {
    failures.push(`missing ${AUTHORITY.compositorApi}`);
    return failures;
  }

  let built;
  try {
    built = await sharedBuild();
  } catch (error) {
    failures.push(`clean V3 build failed: ${error.message}`);
    return failures;
  }
  const builderBase = { authority: ATOMIC };
  const compositorBase = {
    masterBuffers: built.masterBuffers,
    placements: built.placements,
    authoringIdentity: built.authoringIdentity,
  };
  const probes = [
    ["builder", "non-enumerable", "sceneMask", () => productionPacker[AUTHORITY.builderApi](
      hostileInput(builderBase, "non-enumerable", "sceneMask"),
    )],
    ["builder", "symbol", "extra", () => productionPacker[AUTHORITY.builderApi](
      hostileInput(builderBase, "symbol", "extra"),
    )],
    ["compositor", "non-enumerable", "extra", () => productionPacker[AUTHORITY.compositorApi](
      hostileInput(compositorBase, "non-enumerable", "extra"),
    )],
    ["compositor", "symbol", "sceneMask", () => productionPacker[AUTHORITY.compositorApi](
      hostileInput(compositorBase, "symbol", "sceneMask"),
    )],
  ];
  for (const [surface, representation, key, call] of probes) {
    if (!await rejectsCall(call)) failures.push(`${surface} accepted ${representation} ${key}`);
  }
  return failures;
}

const READINESS_FAILURES = await strictnessReadiness();
const READINESS_SKIP = READINESS_FAILURES.length === 0
  ? false
  : `V3_PORTS_RED/READINESS_MISSING: ${READINESS_FAILURES.join("; ")}`;

function expectedPortReceipt() {
  const body = {
    schema: "regional-r5-v3-landmark-port-receipt/v1",
    masterPngSha256: AUTHORITY.landmarkMasterPngSha256,
    edgeTouchingCount: AUTHORITY.edgeTouchingCount,
    cells: KITS.flatMap((kit) => AUTHORITY.landmarkPorts[kit]
      .map(([cell, edgeAlphaSpans]) => ({ kit, cell, edgeAlphaSpans }))),
  };
  return { ...body, canonicalSha256: canonicalDigest(body) };
}

async function decodedMaster(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

test("V3 port receipt and Reflect.ownKeys-closed public inputs are ready", () => {
  assert.deepEqual(
    READINESS_FAILURES,
    [],
    `V3_PORTS_RED/READINESS_MISSING: ${READINESS_FAILURES.join("; ")}`,
  );
});

test("literal authority freezes forty cells and exactly twenty-seven edge contacts", {
  skip: READINESS_SKIP,
}, () => {
  assert.equal(canonicalDigest(AUTHORITY), REGIONAL_R5_V3_PORTS_LITERAL_AUTHORITY_SHA256);
  assertDeeplyFrozen(AUTHORITY, "V3 ports literal authority");
  assert.deepEqual(Object.keys(AUTHORITY.landmarkPorts), KITS);
  const cells = KITS.flatMap((kit) => AUTHORITY.landmarkPorts[kit]);
  assert.equal(cells.length, 40);
  assert.equal(cells.filter(([_cell, edges]) => (
    DIRECTION_NAMES.some((direction) => edges[direction].length > 0)
  )).length, 27);
  for (const kit of KITS) {
    assert.deepEqual(AUTHORITY.landmarkPorts[kit].map(([cell]) => cell), [0, 1, 2, 3, 4, 5, 6, 7]);
    for (const [cell, edges] of AUTHORITY.landmarkPorts[kit]) {
      assert.deepEqual(Object.keys(edges), DIRECTION_NAMES, `${kit}/${cell}: exact N/E/S/W required`);
      for (const direction of DIRECTION_NAMES) {
        let previousEnd = -2;
        for (const [start, end] of edges[direction]) {
          assert.ok(Number.isSafeInteger(start) && Number.isSafeInteger(end)
            && start >= 0 && end < 128 && start <= end,
          `${kit}/${cell}/${direction}: span must be an inclusive in-bounds integer interval`);
          assert.ok(start > previousEnd + 1,
            `${kit}/${cell}/${direction}: adjacent spans must be one contiguous span`);
          previousEnd = end;
        }
      }
    }
  }
});

test("public V3 landmark port receipt is exact, immutable, and detached", {
  skip: READINESS_SKIP,
}, async () => {
  const expected = expectedPortReceipt();
  const first = await productionPacker[AUTHORITY.portReceiptApi]();
  const second = await productionPacker[AUTHORITY.portReceiptApi]();
  assert.deepEqual(first, expected);
  assert.deepEqual(second, expected);
  assert.notStrictEqual(first, second, "public receipt calls must not alias the same root object");
  assertDeeplyFrozen(first, "V3 landmark port receipt");
  assertDeeplyFrozen(second, "V3 landmark port receipt clone");
});

test("decoded V3 landmark masters have no extra, missing, or drifted edge alpha", {
  skip: READINESS_SKIP,
}, async () => {
  const built = await sharedBuild();
  let edgeTouchingCount = 0;
  for (const kit of KITS) {
    const png = built.masterBuffers[`${kit}-landmarks`];
    assert.equal(sha256(png), AUTHORITY.landmarkMasterPngSha256[kit],
      `${kit}: landmark master PNG identity drift`);
    const master = await decodedMaster(png);
    assert.deepEqual(
      [master.width, master.height, master.channels],
      [512, 256, 4],
      `${kit}: landmark master geometry drift`,
    );
    for (const [cellIndex, expectedEdges] of AUTHORITY.landmarkPorts[kit]) {
      const cell = rawCell(master, cellIndex, 128, 128, 4);
      const actualEdges = Object.fromEntries(DIRECTION_NAMES.map((direction) => [
        direction,
        alphaEdgeSpans(cell, direction),
      ]));
      assert.deepEqual(actualEdges, expectedEdges,
        `${kit}/landmark/${cellIndex}: exact edge alpha spans drifted`);
      if (DIRECTION_NAMES.some((direction) => actualEdges[direction].length > 0)) {
        edgeTouchingCount += 1;
      }
    }
  }
  assert.equal(edgeTouchingCount, AUTHORITY.edgeTouchingCount);
});

test("V3 terrain route graph has one off-map entry and one HomeActor yard connector per kit", {
  skip: READINESS_SKIP,
}, async () => {
  const built = await sharedBuild();
  for (const kit of KITS) {
    const routeAuthority = AUTHORITY.routes[kit];
    const route = parseRoute(routeAuthority.path);
    const routeKeys = new Set(route.map(tileKey));
    assert.equal(routeKeys.size, route.length, `${kit}: literal route may not revisit a tile`);
    const [start, next] = route;
    const prior = route.at(-2);
    const terminus = route.at(-1);
    const entryDirection = directionFor(start[0] - next[0], start[1] - next[1]);
    const homeDirection = directionFor(terminus[0] - prior[0], terminus[1] - prior[1]);
    assert.ok(entryDirection, `${kit}: route entry continuation must be cardinal`);
    assert.ok(homeDirection, `${kit}: HomeActor continuation must be cardinal`);
    assert.deepEqual(terminus, routeAuthority.doorTile,
      `${kit}: route must terminate at the exact HomeActor door tile`);
    const [entryDx, entryDy] = DIRECTIONS[entryDirection];
    const entryNeighbor = [start[0] + entryDx, start[1] + entryDy];
    assert.equal(
      entryNeighbor[0] < 0 || entryNeighbor[0] >= AUTHORITY.scene.columns
        || entryNeighbor[1] < 0 || entryNeighbor[1] >= AUTHORITY.scene.rows,
      true,
      `${kit}: the single entry continuation must leave the map`,
    );
    const [homeDx, homeDy] = DIRECTIONS[homeDirection];
    assert.equal(routeKeys.has(tileKey([terminus[0] + homeDx, terminus[1] + homeDy])), false,
      `${kit}: HomeActor/yard connector must continue beyond static route tiles`);

    const terrain = await decodedMaster(built.masterBuffers[`${kit}-terrain`]);
    const ground = rawCell(terrain, 0, 32, 32, 8);
    const groundRgb = rgbaAt(ground, 0, 0).slice(0, 3);
    const rows = REGIONAL_R5_A_PRIME_LITERAL_PLACEMENTS[kit].terrainRows;
    let explicitEntryCount = 0;
    let explicitHomeCount = 0;
    for (const tile of route) {
      const [x, y] = tile;
      const expectedCell = Number.parseInt(rows[y].slice(x * 2, x * 2 + 2), 16);
      const placement = built.placements.scenes[kit].visibleStaticLayers[y * 24 + x];
      assert.deepEqual(
        { atlasId: placement.atlasId, cell: placement.cell, destination: placement.destination },
        { atlasId: `${kit}-terrain`, cell: expectedCell, destination: { x: x * 32, y: y * 32 } },
        `${kit}/${tileKey(tile)}: V3 placement must select the literal terrain cell`,
      );
      const selected = rawCell(terrain, expectedCell, 32, 32, 8);
      const actualPorts = DIRECTION_NAMES.filter((direction) => (
        colorEdgeHasPort(selected, direction, groundRgb)
      ));
      const expectedPorts = DIRECTION_NAMES.filter((direction) => {
        const [dx, dy] = DIRECTIONS[direction];
        const neighborIsRoute = routeKeys.has(tileKey([x + dx, y + dy]));
        const isEntry = x === start[0] && y === start[1] && direction === entryDirection;
        const isHome = x === terminus[0] && y === terminus[1] && direction === homeDirection;
        if (isEntry) explicitEntryCount += 1;
        if (isHome) explicitHomeCount += 1;
        return neighborIsRoute || isEntry || isHome;
      });
      assert.deepEqual(actualPorts, expectedPorts,
        `${kit}/${tileKey(tile)}: unexplained route stub or missing visual join`);
    }
    assert.equal(explicitEntryCount, 1, `${kit}: exactly one explicit off-map continuation required`);
    assert.equal(explicitHomeCount, 1, `${kit}: exactly one HomeActor/yard connector required`);
  }
});

test("builder and atlas compositor reject enumerable, non-enumerable, and Symbol scene inputs", {
  skip: READINESS_SKIP,
}, async () => {
  const built = await sharedBuild();
  const surfaces = [
    ["builder", AUTHORITY.builderApi, { authority: ATOMIC }],
    ["compositor", AUTHORITY.compositorApi, {
      masterBuffers: built.masterBuffers,
      placements: built.placements,
      authoringIdentity: built.authoringIdentity,
    }],
  ];
  for (const [surface, api, base] of surfaces) {
    assert.deepEqual(Reflect.ownKeys(base).sort(compareText), AUTHORITY.closedInputKeys[surface]);
    for (const representation of ["enumerable", "non-enumerable", "symbol"]) {
      for (const name of ["sceneMask", "extra"]) {
        await assert.rejects(
          async () => productionPacker[api](hostileInput(base, representation, name)),
          `${surface}/${representation}/${name}: every additional own key must reject`,
        );
      }
    }
  }
});

test("mutated returned V3 PNG is rejected and cannot poison a subsequent build", {
  skip: READINESS_SKIP,
}, async () => {
  const first = await productionPacker[AUTHORITY.builderApi]({ authority: ATOMIC });
  const names = Reflect.ownKeys(first.masterBuffers).sort(compareText);
  const pristine = Object.fromEntries(names.map((name) => [name, Buffer.from(first.masterBuffers[name])]));
  const target = "worn-heartland-landmarks";
  first.masterBuffers[target][10] ^= 0xff;
  assert.equal(first.masterBuffers[target].equals(pristine[target]), false,
    "regression precondition: returned PNG mutation must change caller-owned bytes");
  await assert.rejects(
    async () => productionPacker[AUTHORITY.compositorApi]({
      masterBuffers: first.masterBuffers,
      placements: first.placements,
      authoringIdentity: first.authoringIdentity,
    }),
    (error) => {
      assert.equal(error?.code, "V3_MASTER_SET_IDENTITY_MISMATCH");
      return true;
    },
  );

  const second = await productionPacker[AUTHORITY.builderApi]({ authority: ATOMIC });
  assert.notStrictEqual(second.masterBuffers, first.masterBuffers);
  for (const name of names) {
    assert.notStrictEqual(second.masterBuffers[name], first.masterBuffers[name],
      `${name}: subsequent build must return a detached PNG Buffer`);
    assert.deepEqual(second.masterBuffers[name], pristine[name],
      `${name}: caller mutation must not poison deterministic future output`);
  }
});
