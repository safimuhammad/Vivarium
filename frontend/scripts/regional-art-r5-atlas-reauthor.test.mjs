/** Contract for the deterministic A-prime atlas-cell reauthor pass. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import sharp from "sharp";

import { REGIONAL_R4_SCENE_PLANS } from "./regional-art-r4-spec.mjs";
import {
  REGIONAL_R5_AUTHORING_SOURCES,
  REGIONAL_R5_MECHANICS_BINDINGS,
} from "./regional-art-r5-authoring-spec.mjs";
import {
  REGIONAL_R5_A_PRIME_LITERAL_PLACEMENTS,
} from "./fixtures/regional-art-r5-atlas-only-literal-authority.mjs";
import * as productionPacker from "./pack-2d-production-assets.mjs";

const KITS = Object.freeze([
  "ash-waste",
  "dry-scrub",
  "neutral-temperate",
  "spring-terraces",
  "worn-heartland",
]);
const RANGE = (start, end) => Array.from({ length: end - start + 1 }, (_, index) => start + index);
const EXPECTED_TARGETS = Object.freeze({
  "ash-waste": Object.freeze({
    terrain: Object.freeze(RANGE(0, 35)),
    scenery: Object.freeze([0, 1, 2, 3, 4, 5, 7, 8, 18, 22, 65, 69, 81, 85, 96, 100]),
    landmarks: Object.freeze(RANGE(0, 7)),
  }),
  "dry-scrub": Object.freeze({
    terrain: Object.freeze(RANGE(0, 35)),
    scenery: Object.freeze([0, 2, 4, 5, 6, 8, 9, 11, 16, 20, 65, 69, 82, 86, 98, 102]),
    landmarks: Object.freeze(RANGE(0, 7)),
  }),
  "neutral-temperate": Object.freeze({
    terrain: Object.freeze(RANGE(0, 35)),
    scenery: Object.freeze([0, 3, 4, 6, 9, 10, 11, 16, 20, 65, 69, 82, 86, 98, 102]),
    landmarks: Object.freeze(RANGE(0, 7)),
  }),
  "spring-terraces": Object.freeze({
    terrain: Object.freeze(RANGE(0, 35)),
    scenery: Object.freeze([0, 1, 3, 4, 7, 8, 16, 20, 64, 68, 69, 73]),
    landmarks: Object.freeze(RANGE(0, 7)),
  }),
  "worn-heartland": Object.freeze({
    terrain: Object.freeze(RANGE(0, 35)),
    scenery: Object.freeze([1, 2, 3, 4, 5, 6, 8, 12, 19, 23, 83, 85, 87, 89]),
    landmarks: Object.freeze(RANGE(0, 7)),
  }),
});
const HOME_PNG_SHA256 = Object.freeze({
  "ash-waste-home-yards": "434ac4f67869661e3b2b93afc92c4181fb515a2dc23657425579a63a09cb9102",
  "dry-scrub-home-yards": "5663ea6f8292fb4d17ddc556246570d2ab18f6ad41b0e5381f59bcc5432ab460",
  "neutral-temperate-home-yards": "13e17622f3375d1242c8d9881ccd4205f78ec6df55464f0df615ae3a4f8242c2",
  "spring-terraces-home-yards": "587c46cd7bfe54fcb96ca0e36dd34732d63b15b74c8c14b3ee260b720281451e",
  "worn-heartland-home-yards": "bdadc63113ecd94e517cf12c3b279a9f581a09b7ca84a057ef4ac0259af09dae",
});
const PORTS = Object.freeze([
  Object.freeze(["w", "e"]), Object.freeze(["n", "s"]), Object.freeze(["n", "e"]),
  Object.freeze(["e", "s"]), Object.freeze(["s", "w"]), Object.freeze(["w", "n"]),
  Object.freeze(["n", "e", "s", "w"]), Object.freeze([]),
]);
const API_READY = typeof productionPacker.regionalR5ReauthorTargets === "function";
const API_SKIP = API_READY ? false : "A_PRIME_ART_RED/API_MISSING";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function sourceBuffers() {
  return {
    regionKits: await readFile(new URL(`../../${REGIONAL_R5_AUTHORING_SOURCES.regionKits.path}`, import.meta.url)),
    homeRuin: await readFile(new URL(`../../${REGIONAL_R5_AUTHORING_SOURCES.homeRuin.path}`, import.meta.url)),
  };
}

function cell(raw, index, width, height) {
  const columns = raw.width / width;
  const left = (index % columns) * width;
  const top = Math.floor(index / columns) * height;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    raw.data.copy(data, y * width * 4, ((top + y) * raw.width + left) * 4,
      ((top + y) * raw.width + left + width) * 4);
  }
  return { data, width, height };
}

function pixel(raw, x, y) {
  const offset = (y * raw.width + x) * 4;
  return [...raw.data.subarray(offset, offset + 4)];
}

function edgeMidpoint(direction) {
  if (direction === "n") return [16, 0];
  if (direction === "e") return [31, 16];
  if (direction === "s") return [16, 31];
  return [0, 16];
}

function edgeMask(raw, direction, base) {
  return Array.from({ length: 32 }, (_unused, offset) => {
    const [x, y] = direction === "n" ? [offset, 0]
      : direction === "e" ? [31, offset]
        : direction === "s" ? [offset, 31] : [0, offset];
    return JSON.stringify(pixel(raw, x, y).slice(0, 3)) !== JSON.stringify(base);
  });
}

function terrainPorts(kit, cellIndex) {
  if (cellIndex >= 8 && cellIndex <= 15) {
    return PORTS[cellIndex - 8];
  }
  if (cellIndex >= 16 && cellIndex <= 23) return PORTS[cellIndex - 16];
  if (cellIndex >= 24 && cellIndex <= 31) return PORTS[cellIndex - 24];
  return [];
}

function tileKey({ x, y }) {
  return `${x},${y}`;
}

test("A-prime reauthor API owns the exact reviewed target-cell inventory", () => {
  assert.equal(typeof productionPacker.regionalR5ReauthorTargets, "function",
    "A_PRIME_ART_RED/API_MISSING: regionalR5ReauthorTargets");
  assert.deepEqual(productionPacker.regionalR5ReauthorTargets(), EXPECTED_TARGETS);
});

test("A-prime reauthor changes only terrain 0-35, reviewed scenery cells, and landmarks 0-7", { skip: API_SKIP }, async () => {
  const authoring = await productionPacker.buildRegionalR5SourceMasters({ sourceBuffers: sourceBuffers() });
  for (const kit of KITS) {
    const terrain = authoring.rawMasters[`${kit}-terrain`];
    for (let index = 36; index < 64; index += 1) {
      assert.equal(cell(terrain, index, 32, 32).data.some((value) => value !== 0), false,
        `${kit}/terrain/${index}: physical blank must remain zero-RGBA`);
    }
    const scenery = authoring.rawMasters[`${kit}-scenery`];
    const targets = new Set(EXPECTED_TARGETS[kit].scenery);
    for (let index = 0; index < 128; index += 1) {
      const layers = authoring.cellLayersByAtlas.get(`${kit}-scenery:${index}`);
      const composed = Buffer.alloc(32 * 32 * 4);
      for (const { raw } of layers) for (let offset = 0; offset < composed.length; offset += 4) {
        if (raw.data[offset + 3] === 0) continue;
        raw.data.copy(composed, offset, offset, offset + 4);
      }
      assert.equal(cell(scenery, index, 32, 32).data.equals(composed), true,
        `${kit}/scenery/${index}: authoritative master/layer composition drift`);
      if (targets.has(index)) assert.ok(layers.some(({ sourceId }) => sourceId.includes("r5-reauthor")),
        `${kit}/scenery/${index}: reauthored cell must retain explicit layer provenance`);
    }
  }
  for (const [atlasId, expected] of Object.entries(HOME_PNG_SHA256)) {
    assert.equal(sha256(authoring.buffers[atlasId]), expected, `${atlasId}: home-yard bytes changed`);
  }
});

test("A-prime reauthored masters preserve binary alpha and transparent zero RGB", { skip: API_SKIP }, async () => {
  const authoring = await productionPacker.buildRegionalR5SourceMasters({ sourceBuffers: sourceBuffers() });
  for (const kit of KITS) for (const family of ["terrain", "scenery", "landmarks"]) {
    const raw = authoring.rawMasters[`${kit}-${family}`];
    for (let offset = 0; offset < raw.data.length; offset += 4) {
      const alpha = raw.data[offset + 3];
      assert.ok(alpha === 0 || alpha === 255, `${kit}-${family}: non-binary alpha`);
      if (alpha === 0) assert.deepEqual([...raw.data.subarray(offset, offset + 3)], [0, 0, 0],
        `${kit}-${family}: transparent RGB leak`);
    }
  }
});

test("A-prime terrain route, water, and shore cells retain their exact directional ports", { skip: API_SKIP }, async () => {
  const authoring = await productionPacker.buildRegionalR5SourceMasters({ sourceBuffers: sourceBuffers() });
  for (const kit of KITS) {
    const terrain = authoring.rawMasters[`${kit}-terrain`];
    const base = pixel(cell(terrain, 0, 32, 32), 0, 0).slice(0, 3);
    for (const familyStart of [8, 16, 24]) for (const [offset, expectedPorts] of PORTS.entries()) {
      const tile = cell(terrain, familyStart + offset, 32, 32);
      for (const direction of ["n", "e", "s", "w"]) {
        const [x, y] = edgeMidpoint(direction);
        assert.equal(JSON.stringify(pixel(tile, x, y).slice(0, 3)) !== JSON.stringify(base),
          expectedPorts.includes(direction), `${kit}/terrain/${familyStart + offset}/${direction}: port drift`);
        const mask = edgeMask(tile, direction, base);
        assert.equal(mask.some(Boolean), expectedPorts.includes(direction),
          `${kit}/terrain/${familyStart + offset}/${direction}: edge-mask port drift`);
      }
    }
    for (const familyStart of [8, 16, 24]) {
      const masks = { n: [], e: [], s: [], w: [] };
      for (let offset = 0; offset < 8; offset += 1) {
        const tile = cell(terrain, familyStart + offset, 32, 32);
        for (const direction of ["n", "e", "s", "w"]) {
          if (terrainPorts(kit, familyStart + offset).includes(direction)) {
            masks[direction].push(edgeMask(tile, direction, base));
          }
        }
      }
      for (const direction of ["n", "e", "s", "w"]) for (const mask of masks[direction]) {
        assert.deepEqual(mask, masks[direction][0], `${kit}/${familyStart}/${direction}: incompatible same-side edge mask`);
      }
      assert.deepEqual(masks.n[0], masks.s[0], `${kit}/${familyStart}: north/south edge masks must mate`);
      assert.deepEqual(masks.e[0], masks.w[0], `${kit}/${familyStart}: east/west edge masks must mate`);
    }
  }
  assert.equal(typeof REGIONAL_R5_MECHANICS_BINDINGS.scenePlans, "object");
});

test("A-prime scene route graph has no unexplained visual stubs", { skip: API_SKIP }, async () => {
  const authoring = await productionPacker.buildRegionalR5SourceMasters({ sourceBuffers: sourceBuffers() });
  const directions = Object.freeze({ n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] });
  for (const kit of KITS) {
    const plan = REGIONAL_R4_SCENE_PLANS[kit];
    const route = new Set(plan.routeTiles.map(tileKey));
    const terrain = authoring.rawMasters[`${kit}-terrain`];
    const base = pixel(cell(terrain, 0, 32, 32), 0, 0).slice(0, 3);
    const rows = REGIONAL_R5_A_PRIME_LITERAL_PLACEMENTS[kit].terrainRows;
    const directionFor = (dx, dy) => Object.entries(directions)
      .find(([_direction, vector]) => vector[0] === dx && vector[1] === dy)?.[0];
    const start = plan.routeTiles[0];
    const next = plan.routeTiles[1];
    const terminus = plan.routeTiles.at(-1);
    const prior = plan.routeTiles.at(-2);
    const startExternal = directionFor(start.x - next.x, start.y - next.y);
    const homeExternal = directionFor(terminus.x - prior.x, terminus.y - prior.y);
    assert.ok(startExternal, `${kit}: route start must have a cardinal off-map continuation`);
    assert.ok(homeExternal, `${kit}: route terminus must have a cardinal HomeActor continuation`);
    const startVector = directions[startExternal];
    assert.ok(start.x + startVector[0] < 0 || start.x + startVector[0] >= 24
      || start.y + startVector[1] < 0 || start.y + startVector[1] >= 16,
    `${kit}: declared route entry continuation must leave the map`);
    assert.deepEqual(terminus, plan.home.doorTile, `${kit}: declared dynamic continuation must end at HomeActor`);
    for (const tile of plan.routeTiles) {
      const cellIndex = Number.parseInt(rows[tile.y].slice(tile.x * 2, tile.x * 2 + 2), 16);
      const selected = cell(terrain, cellIndex, 32, 32);
      const actualPorts = Object.keys(directions).filter((direction) => (
        edgeMask(selected, direction, base).some(Boolean)
      ));
      for (const [direction, [dx, dy]] of Object.entries(directions)) {
        const neighbor = { x: tile.x + dx, y: tile.y + dy };
        const neighborIsRoute = route.has(tileKey(neighbor));
        const declaredExternal = (tile.x === start.x && tile.y === start.y && direction === startExternal)
          || (tile.x === terminus.x && tile.y === terminus.y && direction === homeExternal);
        assert.equal(actualPorts.includes(direction), neighborIsRoute || declaredExternal,
        `${kit}/${tileKey(tile)}/${direction}: unexplained route port or missing route join`);
      }
    }
  }
});

test("semantic-reuse scenery cells remain quiet joiners rather than conflicting trees", { skip: API_SKIP }, async () => {
  const authoring = await productionPacker.buildRegionalR5SourceMasters({ sourceBuffers: sourceBuffers() });
  for (const [kit, index] of [["ash-waste", 0], ["spring-terraces", 73], ["worn-heartland", 12]]) {
    const tile = cell(authoring.rawMasters[`${kit}-scenery`], index, 32, 32);
    let upperOpaque = 0;
    const upperColumns = new Set();
    for (let y = 0; y < 16; y += 1) for (let x = 0; x < 32; x += 1) {
      if (pixel(tile, x, y)[3] === 0) continue;
      upperOpaque += 1;
      upperColumns.add(x);
    }
    assert.ok(upperOpaque < 180, `${kit}/scenery/${index}: reused joiner grew a canopy silhouette`);
    assert.ok(upperColumns.size < 12, `${kit}/scenery/${index}: reused joiner reads as a focal tree crown`);
  }
});

test("V2 terrain removes phase-locked stamps while retaining quiet and organic material cells", { skip: API_SKIP }, async () => {
  const authoring = await productionPacker.buildRegionalR5SourceMasters({ sourceBuffers: sourceBuffers() });
  for (const kit of KITS) {
    const terrain = authoring.rawMasters[`${kit}-terrain`];
    const base = pixel(cell(terrain, 0, 32, 32), 0, 0).slice(0, 3);
    const nonBaseCount = (tile) => {
      let count = 0;
      for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
        if (JSON.stringify(pixel(tile, x, y).slice(0, 3)) !== JSON.stringify(base)) count += 1;
      }
      return count;
    };
    const groundCounts = RANGE(0, 7).map((index) => nonBaseCount(cell(terrain, index, 32, 32)));
    assert.ok(groundCounts.filter((count) => count <= 4).length >= 4,
      `${kit}: at least half the calm ground cells must remain visually quiet`);
    assert.ok(groundCounts.filter((count) => count >= 28).length >= 3,
      `${kit}: textured ground cells need meaningful irregular material mass`);

    const pathCells = RANGE(8, 15).map((index) => cell(terrain, index, 32, 32));
    let sharedNonBasePhase = 0;
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
      if (x >= 12 && x <= 20 && y >= 12 && y <= 20) continue;
      const colors = pathCells.map((tile) => JSON.stringify(pixel(tile, x, y).slice(0, 3)));
      if (new Set(colors).size === 1 && colors[0] !== JSON.stringify(base)) sharedNonBasePhase += 1;
    }
    assert.ok(sharedNonBasePhase < 8, `${kit}: universal path highlight/cadence remains ${sharedNonBasePhase}px`);

    const soilCounts = RANGE(32, 35).map((index) => nonBaseCount(cell(terrain, index, 32, 32)));
    assert.ok(soilCounts.every((count) => count > 24 && count < 260),
      `${kit}: soil must be integrated texture, not an opaque stripe stamp`);
    assert.ok(new Set(soilCounts).size >= 3, `${kit}: soil variants repeat the same micro-grid mass`);
  }
});

test("V2 landmark families have varied organic footprints and occupiable openings", { skip: API_SKIP }, async () => {
  const authoring = await productionPacker.buildRegionalR5SourceMasters({ sourceBuffers: sourceBuffers() });
  for (const kit of KITS) {
    const landmarks = RANGE(0, 7).map((index) => cell(
      authoring.rawMasters[`${kit}-landmarks`], index, 128, 128,
    ));
    let sharedOpaquePixels = 0;
    for (let y = 0; y < 128; y += 1) for (let x = 0; x < 128; x += 1) {
      if (landmarks.every((landmark) => pixel(landmark, x, y)[3] === 255)) sharedOpaquePixels += 1;
    }
    assert.ok(sharedOpaquePixels < 1800,
      `${kit}: universal opaque/fringed landmark base remains ${sharedOpaquePixels}px`);
  }

  const neutral = authoring.rawMasters["neutral-temperate-landmarks"];
  const worn = authoring.rawMasters["worn-heartland-landmarks"];
  const transparentShare = (tile, left, top, width, height) => {
    let transparent = 0;
    for (let y = top; y < top + height; y += 1) for (let x = left; x < left + width; x += 1) {
      if (pixel(tile, x, y)[3] === 0) transparent += 1;
    }
    return transparent / (width * height);
  };
  assert.ok(transparentShare(cell(neutral, 3, 128, 128), 46, 92, 36, 36) > 0.7,
    "neutral south-open hedge needs an occupiable entrance, not a striped base");
  assert.ok(transparentShare(cell(neutral, 4, 128, 128), 88, 43, 40, 38) > 0.7,
    "neutral side-open boundary needs an occupiable gap");
  assert.ok(transparentShare(cell(worn, 3, 128, 128), 46, 92, 36, 36) > 0.65,
    "worn garden needs an occupiable south opening");
  assert.ok(transparentShare(cell(worn, 4, 128, 128), 88, 43, 40, 38) > 0.65,
    "worn garden needs an occupiable east opening");
});

test("A-prime landmarks reject opaque rectangular mats at native resolution", { skip: API_SKIP }, async () => {
  const authoring = await productionPacker.buildRegionalR5SourceMasters({ sourceBuffers: sourceBuffers() });
  for (const kit of KITS) for (let index = 0; index < 8; index += 1) {
    const landmark = cell(authoring.rawMasters[`${kit}-landmarks`], index, 128, 128);
    let opaque = 0;
    let opaqueBorder = 0;
    for (let y = 0; y < 128; y += 1) for (let x = 0; x < 128; x += 1) {
      if (pixel(landmark, x, y)[3] === 0) continue;
      opaque += 1;
      if (x === 0 || x === 127 || y === 0 || y === 127) opaqueBorder += 1;
    }
    assert.ok(opaque / (128 * 128) < 0.82, `${kit}/landmark/${index}: opaque mat coverage`);
    assert.ok(opaqueBorder < 320, `${kit}/landmark/${index}: rectangular border frame`);
  }
});

test("A-prime scenes remain exactly master-only after the reauthor pass", { skip: API_SKIP }, async () => {
  const authoring = await productionPacker.buildRegionalR5SourceMasters({ sourceBuffers: sourceBuffers() });
  const result = await productionPacker.buildRegionalR5AtlasOnlyScenes({
    masterBuffers: authoring.buffers,
    placements: productionPacker.regionalR5AtlasOnlyScenePlacements(),
  });
  assert.equal(result.atlasOnly, true);
  assert.equal(result.masterCount, 20);
  for (const kit of KITS) {
    assert.equal(result.scenes[kit].visibleStaticLayers.length, 408);
    assert.equal(result.scenes[kit].visibleStaticLayers.every(({ provenance }) => (
      provenance.atlasId.startsWith(`${kit}-`)
    )), true);
  }
});
