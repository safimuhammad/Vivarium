/**
 * RED contract for the R5 A-prime atlas-only scene boundary.
 *
 * This oracle intentionally fails until the packer exposes a pure compositor and
 * a closed placement authority. It never accepts the currently rejected scene
 * hashes as targets: the replacement art earns new hashes after blind review.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

import sharp from "sharp";

import {
  REGIONAL_R4_SCENE_PLANS,
  REGIONAL_R4_VARIANT_RECIPES,
} from "./regional-art-r4-spec.mjs";
import {
  REGIONAL_R5_KEY_SCENES,
  REGIONAL_R5_MECHANICS_BINDINGS,
} from "./regional-art-r5-authoring-spec.mjs";
import {
  REGIONAL_R5_A_PRIME_LITERAL_PLACEMENTS,
  REGIONAL_R5_A_PRIME_LITERAL_PLACEMENTS_SHA256,
} from "./fixtures/regional-art-r5-atlas-only-literal-authority.mjs";
import * as productionPacker from "./pack-2d-production-assets.mjs";

const KITS = Object.freeze([
  "ash-waste",
  "dry-scrub",
  "neutral-temperate",
  "spring-terraces",
  "worn-heartland",
]);
const MASTER_FAMILIES = Object.freeze([
  "terrain",
  "scenery",
  "landmarks",
  "home-yards",
]);
const MASTER_NAMES = Object.freeze(KITS.flatMap((kit) => (
  MASTER_FAMILIES.map((family) => `${kit}-${family}`)
)).sort(compareText));
const DIRECT_SCENE_SOURCE_COLLECTIONS = Object.freeze({
  "ash-waste": Object.freeze(["literalPatchLayers"]),
  "dry-scrub": Object.freeze([
    "literalPatchLayers", "completeUnderlayLayers", "completeForegroundLayers",
  ]),
  "neutral-temperate": Object.freeze(["macroLayers"]),
  "spring-terraces": Object.freeze([
    "macroLayers", "supportLayers", "literalPatchLayers", "completeUnderlayLayers",
  ]),
  "worn-heartland": Object.freeze(["literalPatchLayers"]),
});
const EXPECTED_EXPANDED_AUTHORITY_SHA256 =
  "056188f88c281e0832eb09ad727281c69a1f83a1ddc73555802c735302b455eb";
const REGION_GUIDE = new URL(
  "../../scratchpad/2d-production-art/source/imagegen-concepts/region-kits-imagegen-guide.png",
  import.meta.url,
);
const HOME_RUIN_GUIDE = new URL(
  "../../scratchpad/2d-production-art/source/imagegen-concepts/home-ruin-imagegen-guide.png",
  import.meta.url,
);
const ATLAS_ONLY_COMPOSITOR_MODULE = new URL(
  "./regional-art-r5-atlas-only-scene.mjs",
  import.meta.url,
);
const PUBLICATION_ROOTS = Object.freeze([
  new URL("../public/assets/2d/", import.meta.url),
  new URL("../../scratchpad/2d-production-art/source/native/", import.meta.url),
  new URL("../../scratchpad/2d-production-art/evidence/", import.meta.url),
]);
const API_EXPORTS = Object.freeze([
  "buildRegionalR5AtlasOnlyScenes",
  "regionalR5AtlasOnlyScenePlacements",
]);
const MISSING_API_EXPORTS = API_EXPORTS.filter((name) => (
  typeof productionPacker[name] !== "function"
));
const API_READY = MISSING_API_EXPORTS.length === 0;
const API_SKIP = API_READY
  ? false
  : `A_PRIME_RED/API_MISSING: ${MISSING_API_EXPORTS.join(", ")}`;

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

function cloneBuffers(buffers) {
  return Object.fromEntries(Object.entries(buffers).map(([name, buffer]) => [
    name,
    Buffer.from(buffer),
  ]));
}

function directSceneSourceCounts() {
  return Object.fromEntries(KITS.map((kit) => {
    const scene = REGIONAL_R5_KEY_SCENES[kit];
    const count = DIRECT_SCENE_SOURCE_COLLECTIONS[kit].reduce((total, field) => {
      const layers = scene[field] ?? [];
      if (field === "macroLayers") return total + layers.length;
      return total + layers.filter((layer) => typeof layer?.patchId === "string").length;
    }, 0);
    return [kit, count];
  }));
}

function fixtureTerrainLayers(kit, rows) {
  assert.equal(rows.length, 16, `${kit}: fixture must pin exactly sixteen terrain rows`);
  return rows.flatMap((row, y) => {
    assert.match(row, /^(?:[A-Fa-f0-9]{2}){24}$/u, `${kit}/row-${y}: exact 24-cell row`);
    return Array.from({ length: 24 }, (_unused, x) => ({
      id: `r5-atlas-only/${kit}/terrain/${y}/${x}`,
      role: "terrain-foundation",
      atlasId: `${kit}-terrain`,
      cell: Number.parseInt(row.slice(x * 2, x * 2 + 2), 16),
      destination: { x: x * 32, y: y * 32 },
    }));
  });
}

function fixtureObjectLayers(kit, tuples, family, label) {
  return tuples.map(([cell, x, y, role], index) => ({
    id: `r5-atlas-only/${kit}/${label}/${index}`,
    role,
    atlasId: `${kit}-${family}`,
    cell,
    destination: { x, y },
  }));
}

function independentPlacementAuthority() {
  const body = {
    schema: "regional-r5-atlas-only-placement-authority/v1",
    scenes: Object.fromEntries(KITS.map((kit) => {
      const fixture = REGIONAL_R5_A_PRIME_LITERAL_PLACEMENTS[kit];
      return [kit, {
        kit,
        visibleStaticLayers: [
          ...fixtureTerrainLayers(kit, fixture.terrainRows),
          ...fixtureObjectLayers(kit, fixture.landmarks, "landmarks", "landmark"),
          ...fixtureObjectLayers(kit, fixture.supports, "scenery", "support"),
        ],
        identities: expectedIdentities(kit),
      }];
    })),
  };
  return { ...body, canonicalSha256: canonicalDigest(body) };
}

function terrainRole(cell) {
  if (cell >= 0 && cell <= 7) return "ground";
  if (cell <= 15) return "route";
  if (cell <= 23) return "water";
  if (cell <= 31) return "shore";
  if (cell <= 35) return "soil";
  return "invalid";
}

function tileKey({ x, y }) {
  return `${x},${y}`;
}

function expectedIdentities(kit) {
  const homeProof = REGIONAL_R5_MECHANICS_BINDINGS.visualProofBindings
    .homeActorProofs.kitProofs.find((candidate) => candidate.kitId === kit);
  assert.ok(homeProof, `${kit}: canonical HomeActor proof must exist`);
  return {
    r4ScenePlanSha256: canonicalDigest(REGIONAL_R4_SCENE_PLANS[kit]),
    r4VariantRecipeSha256: canonicalDigest(REGIONAL_R4_VARIANT_RECIPES[kit]),
    mechanicsScenePlanSha256: canonicalDigest(REGIONAL_R5_MECHANICS_BINDINGS.scenePlans[kit]),
    homeActorRgbaSha256: homeProof.homeActorRgbaSha256,
    productionHumanRgbaSha256: REGIONAL_R5_MECHANICS_BINDINGS.productionHuman.canonicalPatchSha256,
    humanPlacementsSha256: canonicalDigest(REGIONAL_R5_KEY_SCENES[kit].humanLayers),
  };
}

function expectedAtlasGeometry(atlasId) {
  if (atlasId.endsWith("-terrain")) {
    return { width: 256, height: 256, cellWidth: 32, cellHeight: 32, columns: 8, rows: 8 };
  }
  if (atlasId.endsWith("-scenery")) {
    return { width: 512, height: 256, cellWidth: 32, cellHeight: 32, columns: 16, rows: 8 };
  }
  if (atlasId.endsWith("-landmarks")) {
    return { width: 512, height: 256, cellWidth: 128, cellHeight: 128, columns: 4, rows: 2 };
  }
  if (atlasId.endsWith("-home-yards")) {
    return { width: 960, height: 160, cellWidth: 192, cellHeight: 160, columns: 5, rows: 1 };
  }
  assert.fail(`foreign atlas provenance ${atlasId}`);
}

function assertExactAtlasProvenance(layer, masterBuffers, label) {
  assert.deepEqual(
    Object.keys(layer).sort(compareText),
    ["contributedOpaquePixels", "destination", "id", "provenance", "role"],
    `${label}: visible static layer schema must be closed`,
  );
  assert.equal(typeof layer.id, "string", `${label}: layer ID must be explicit`);
  assert.equal(typeof layer.role, "string", `${label}: semantic role must be explicit`);
  assert.ok(Number.isSafeInteger(layer.contributedOpaquePixels)
    && layer.contributedOpaquePixels > 0, `${label}: layer must contribute visible alpha`);
  const provenance = layer.provenance;
  assert.deepEqual(
    Object.keys(provenance).sort(compareText),
    ["atlasId", "cell", "masterPngSha256", "sourceRect", "sourceRgbaSha256"],
    `${label}: provenance must be an exact atlas rect/cell receipt`,
  );
  assert.ok(MASTER_NAMES.includes(provenance.atlasId), `${label}: foreign atlas source`);
  assert.equal(provenance.masterPngSha256, sha256(masterBuffers[provenance.atlasId]),
    `${label}: master PNG identity drift`);
  assert.match(provenance.sourceRgbaSha256, /^[a-f0-9]{64}$/u,
    `${label}: source RGBA identity must be byte-derived`);

  const geometry = expectedAtlasGeometry(provenance.atlasId);
  const { sourceRect, cell } = provenance;
  assert.deepEqual(Object.keys(sourceRect).sort(compareText), ["height", "width", "x", "y"]);
  assert.deepEqual(Object.keys(cell).sort(compareText), ["column", "index", "row"]);
  for (const value of [...Object.values(sourceRect), ...Object.values(cell)]) {
    assert.ok(Number.isSafeInteger(value), `${label}: atlas provenance must use integers`);
  }
  assert.ok(cell.index >= 0 && cell.index < geometry.columns * geometry.rows,
    `${label}: atlas cell is out of range`);
  assert.equal(cell.column, cell.index % geometry.columns, `${label}: cell column drift`);
  assert.equal(cell.row, Math.floor(cell.index / geometry.columns), `${label}: cell row drift`);
  assert.deepEqual(sourceRect, {
    x: cell.column * geometry.cellWidth,
    y: cell.row * geometry.cellHeight,
    width: geometry.cellWidth,
    height: geometry.cellHeight,
  }, `${label}: source rect must equal its exact native cell`);
  assert.ok(sourceRect.x + sourceRect.width <= geometry.width
    && sourceRect.y + sourceRect.height <= geometry.height,
  `${label}: source rect exceeds its master`);

  assert.deepEqual(Object.keys(layer.destination).sort(compareText), ["height", "width", "x", "y"]);
  assert.ok(Object.values(layer.destination).every(Number.isSafeInteger),
    `${label}: destination placement must use integers`);
  assert.equal(layer.destination.width, sourceRect.width, `${label}: scaling is forbidden`);
  assert.equal(layer.destination.height, sourceRect.height, `${label}: scaling is forbidden`);
  const forbidden = canonicalJson(layer).match(
    /actorless|backdrop|fragmentId|full-world|guideId|macroId|patchId|proofPixels|sourceId/giu,
  );
  assert.equal(forbidden, null, `${label}: direct-scene source vocabulary is forbidden`);
}

async function decodeMasters(masterBuffers) {
  return Object.fromEntries(await Promise.all(MASTER_NAMES.map(async (atlasId) => {
    const geometry = expectedAtlasGeometry(atlasId);
    const { data, info } = await sharp(masterBuffers[atlasId])
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.deepEqual([info.width, info.height, info.channels],
      [geometry.width, geometry.height, 4], `${atlasId}: decoded master geometry drift`);
    return [atlasId, { data, width: info.width, height: info.height }];
  })));
}

function independentlyFlattenScene(layers, decodedMasters, label) {
  const width = 768;
  const height = 512;
  const output = Buffer.alloc(width * height * 4);
  for (const [layerIndex, layer] of layers.entries()) {
    const source = decodedMasters[layer.provenance.atlasId];
    const rect = layer.provenance.sourceRect;
    const sourceCell = Buffer.alloc(rect.width * rect.height * 4);
    let opaquePixels = 0;
    for (let y = 0; y < rect.height; y += 1) {
      const sourceStart = ((rect.y + y) * source.width + rect.x) * 4;
      source.data.copy(sourceCell, y * rect.width * 4, sourceStart,
        sourceStart + rect.width * 4);
    }
    assert.equal(sha256(sourceCell), layer.provenance.sourceRgbaSha256,
      `${label}/layer-${layerIndex}: source RGBA receipt is not byte-derived`);
    for (let y = 0; y < rect.height; y += 1) for (let x = 0; x < rect.width; x += 1) {
      const sourceOffset = (y * rect.width + x) * 4;
      const alpha = sourceCell[sourceOffset + 3];
      assert.ok(alpha === 0 || alpha === 255,
        `${label}/layer-${layerIndex}: atlas-only compositor requires binary source alpha`);
      if (alpha === 0) continue;
      const destinationX = layer.destination.x + x;
      const destinationY = layer.destination.y + y;
      if (destinationX < 0 || destinationY < 0
          || destinationX >= width || destinationY >= height) continue;
      opaquePixels += 1;
      sourceCell.copy(output, (destinationY * width + destinationX) * 4,
        sourceOffset, sourceOffset + 4);
    }
    assert.equal(layer.contributedOpaquePixels, opaquePixels,
      `${label}/layer-${layerIndex}: visible-alpha receipt drift`);
  }
  return output;
}

function independentlyMeasureFinalLayerOwnership(layers, decodedMasters) {
  const width = 768;
  const height = 512;
  const owners = new Int16Array(width * height);
  owners.fill(-1);
  for (const [layerIndex, layer] of layers.entries()) {
    const source = decodedMasters[layer.provenance.atlasId];
    const rect = layer.provenance.sourceRect;
    for (let y = 0; y < rect.height; y += 1) for (let x = 0; x < rect.width; x += 1) {
      const sourceOffset = ((rect.y + y) * source.width + rect.x + x) * 4;
      if (source.data[sourceOffset + 3] === 0) continue;
      const destinationX = layer.destination.x + x;
      const destinationY = layer.destination.y + y;
      if (destinationX < 0 || destinationY < 0
          || destinationX >= width || destinationY >= height) continue;
      owners[destinationY * width + destinationX] = layerIndex;
    }
  }
  const visiblePixels = new Uint32Array(layers.length);
  for (const owner of owners) if (owner >= 0) visiblePixels[owner] += 1;
  return visiblePixels;
}

async function publicationSnapshot() {
  const entries = [];
  const visit = async (url, prefix) => {
    let names;
    try {
      names = await readdir(url);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const name of names.sort(compareText)) {
      const child = new URL(name, url);
      const metadata = await stat(child);
      const relative = `${prefix}/${name}`;
      if (metadata.isDirectory()) await visit(new URL(`${name}/`, url), relative);
      else entries.push([relative, sha256(await readFile(child))]);
    }
  };
  for (const [index, root] of PUBLICATION_ROOTS.entries()) await visit(root, String(index));
  return canonicalDigest(entries);
}

let masterBuffersPromise;
async function exactMasterBuffers() {
  masterBuffersPromise ??= (async () => {
    const authoring = await productionPacker.buildRegionalR5SourceMasters({
      sourceBuffers: {
        regionKits: await readFile(REGION_GUIDE),
        homeRuin: await readFile(HOME_RUIN_GUIDE),
      },
    });
    assert.deepEqual(Object.keys(authoring.buffers).sort(compareText), MASTER_NAMES);
    return Object.freeze(Object.fromEntries(MASTER_NAMES.map((name) => [
      name,
      Buffer.from(authoring.buffers[name]),
    ])));
  })();
  return masterBuffersPromise;
}

async function validInput() {
  return {
    masterBuffers: cloneBuffers(await exactMasterBuffers()),
    placements: productionPacker.regionalR5AtlasOnlyScenePlacements(),
  };
}

async function expectAtlasOnlyError(input, code, message) {
  await assert.rejects(
    productionPacker.buildRegionalR5AtlasOnlyScenes(input),
    (error) => {
      assert.equal(error?.name, "RegionalR5AtlasOnlySceneError");
      assert.equal(error?.code, code);
      assert.match(error?.message ?? "", message);
      return true;
    },
  );
}

test("RED A-prime exports the pure atlas-only compositor and closed placement authority", () => {
  assert.deepEqual(
    MISSING_API_EXPORTS,
    [],
    `A_PRIME_RED/API_MISSING: ${MISSING_API_EXPORTS.join(", ")}`,
  );
});

test("A-prime production placements equal the complete independent literal preimage and digest", async () => {
  assert.equal(
    canonicalDigest(REGIONAL_R5_A_PRIME_LITERAL_PLACEMENTS),
    REGIONAL_R5_A_PRIME_LITERAL_PLACEMENTS_SHA256,
    "test-only placement fixture identity drift",
  );
  const input = await validInput();
  const independentAuthority = independentPlacementAuthority();
  assert.equal(independentAuthority.canonicalSha256, EXPECTED_EXPANDED_AUTHORITY_SHA256,
    "independent expanded placement authority identity drift");
  assert.deepEqual(input.placements, independentAuthority,
    "production placement authority must equal every independently reviewed terrain/object tuple");
  for (const kit of KITS) {
    assert.equal(independentAuthority.scenes[kit].visibleStaticLayers.length, 408);
  }
});

test("A-prime terrain cells preserve exact R4 route-over-water-over-shore and bridge topology", () => {
  for (const kit of KITS) {
    const plan = REGIONAL_R4_SCENE_PLANS[kit];
    const route = new Set(plan.routeTiles.map(tileKey));
    const water = new Set(plan.waterTiles.map(tileKey));
    const shore = new Set(plan.shoreTiles.map(tileKey));
    const bridge = new Set(plan.bridgeTiles.map(tileKey));
    const terrain = fixtureTerrainLayers(
      kit,
      REGIONAL_R5_A_PRIME_LITERAL_PLACEMENTS[kit].terrainRows,
    );
    for (const layer of terrain) {
      const tile = {
        x: layer.destination.x / 32,
        y: layer.destination.y / 32,
      };
      const key = tileKey(tile);
      const expectedRole = route.has(key)
        ? "route"
        : water.has(key) ? "water" : shore.has(key) ? "shore" : null;
      const actualRole = terrainRole(layer.cell);
      if (expectedRole === null) {
        assert.ok(actualRole === "ground" || actualRole === "soil",
          `${kit}/${key}: non-topology tile may not invent ${actualRole}`);
      } else {
        assert.equal(actualRole, expectedRole,
          `${kit}/${key}: terrain role must preserve R4 topology precedence`);
      }
      if (bridge.has(key)) {
        assert.equal(route.has(key), true, `${kit}/${key}: R4 bridge must remain a route tile`);
        assert.equal(water.has(key), true, `${kit}/${key}: R4 bridge must remain over water`);
        assert.equal(actualRole, "route", `${kit}/${key}: bridge renders the route surface`);
      }
    }
  }
});

test("A-prime rejects the current five direct-scene closures with exact per-kit counts", {
  skip: API_SKIP,
}, async () => {
  const input = await validInput();
  await assert.rejects(
    productionPacker.buildRegionalR5AtlasOnlyScenes({
      ...input,
      placements: REGIONAL_R5_KEY_SCENES,
    }),
    (error) => {
      assert.equal(error?.name, "RegionalR5AtlasOnlySceneError");
      assert.equal(error?.code, "DIRECT_SCENE_SOURCE_FORBIDDEN");
      assert.deepEqual(error?.directSceneSourceCounts, directSceneSourceCounts());
      assert.match(error?.message ?? "", /atlas-only.*direct.*source/iu);
      return true;
    },
  );
});

test("A-prime emits five unhashed-target RGBA scenes whose visible static layers have exact atlas provenance", {
  skip: API_SKIP,
}, async () => {
  const input = await validInput();
  const before = await publicationSnapshot();
  const result = await productionPacker.buildRegionalR5AtlasOnlyScenes(input);
  const after = await publicationSnapshot();
  assert.equal(after, before, "atlas-only proof composition must not publish files");
  assert.equal(result.schema, "regional-r5-atlas-only-scenes/v1");
  assert.equal(result.atlasOnly, true);
  assert.equal(result.published, false);
  assert.equal(result.masterCount, 20);
  assert.deepEqual(result.masterNames, MASTER_NAMES);
  assert.deepEqual(Object.keys(result.scenes).sort(compareText), KITS);
  assert.equal(result.masterSetSha256, canonicalDigest(Object.fromEntries(MASTER_NAMES.map((name) => [
    name, sha256(input.masterBuffers[name]),
  ]))), "master-set receipt must bind art bytes separately from placement identity");
  assert.equal(result.placementSha256, input.placements.canonicalSha256);
  const decodedMasters = await decodeMasters(input.masterBuffers);

  for (const kit of KITS) {
    const scene = result.scenes[kit];
    assert.equal(scene.kit, kit);
    assert.deepEqual(
      [scene.raw?.width, scene.raw?.height, scene.raw?.channels],
      [768, 512, 4],
      `${kit}: atlas-only scene must remain native 768x512 RGBA`,
    );
    assert.ok(Buffer.isBuffer(scene.raw.data), `${kit}: scene pixels must be a Buffer`);
    assert.equal(scene.raw.data.length, 768 * 512 * 4, `${kit}: RGBA byte length drift`);
    assert.equal(scene.rgbaSha256, sha256(scene.raw.data), `${kit}: scene RGBA receipt drift`);
    assert.match(scene.rgbaSha256, /^[a-f0-9]{64}$/u);
    assert.ok(Array.isArray(scene.visibleStaticLayers));
    assert.equal(scene.visibleStaticLayers.length, 408,
      `${kit}: static scene must contain exact 384 terrain + 8 landmarks + 16 supports`);
    assert.equal(new Set(scene.visibleStaticLayers.map(({ id }) => id)).size,
      scene.visibleStaticLayers.length, `${kit}: visible layer IDs must be unique`);
    const familyCounts = {
      terrain: 0,
      scenery: 0,
      landmarks: 0,
      "home-yards": 0,
    };
    for (const layer of scene.visibleStaticLayers) {
      const family = MASTER_FAMILIES.find((candidate) => (
        layer.provenance.atlasId.endsWith(`-${candidate}`)
      ));
      assert.ok(family, `${kit}/${layer.id}: static layer uses an unknown master family`);
      familyCounts[family] += 1;
    }
    assert.deepEqual(familyCounts, {
      terrain: 384,
      scenery: 16,
      landmarks: 8,
      "home-yards": 0,
    }, `${kit}: exact static family closure drift`);
    assert.ok(scene.visibleStaticLayers.slice(0, 384).every((layer, index) => (
      layer.provenance.atlasId === `${kit}-terrain`
      && layer.destination.x === (index % 24) * 32
      && layer.destination.y === Math.floor(index / 24) * 32
    )), `${kit}: terrain must be exact 24x16 row-major foundation`);
    assert.ok(scene.visibleStaticLayers.slice(384, 392).every((layer) => (
      layer.provenance.atlasId === `${kit}-landmarks`
    )), `${kit}: landmarks must follow terrain in static-back order`);
    assert.deepEqual(scene.visibleStaticLayers.slice(384, 392)
      .map((layer) => layer.provenance.cell.index).sort((left, right) => left - right),
    [0, 1, 2, 3, 4, 5, 6, 7], `${kit}: all eight landmark cells must appear exactly once`);
    assert.ok(scene.visibleStaticLayers.slice(392).every((layer) => (
      layer.provenance.atlasId === `${kit}-scenery`
    )), `${kit}: exact sixteen joined supports must close the static scene`);
    for (const [index, layer] of scene.visibleStaticLayers.entries()) {
      assertExactAtlasProvenance(layer, input.masterBuffers, `${kit}/layer-${index}`);
    }
    const independentFlatten = independentlyFlattenScene(
      scene.visibleStaticLayers,
      decodedMasters,
      kit,
    );
    assert.deepEqual(scene.raw.data, independentFlatten,
      `${kit}: scene pixels must equal the independent exact atlas-cell flatten`);
    assert.equal(scene.rgbaSha256, sha256(independentFlatten),
      `${kit}: scene hash must bind the independent exact atlas-cell flatten`);
    assert.deepEqual(scene.identities, expectedIdentities(kit),
      `${kit}: R4 plan, mechanics, HomeActor, and human identities must remain exact`);
    const finalOwnership = independentlyMeasureFinalLayerOwnership(
      scene.visibleStaticLayers,
      decodedMasters,
    );
    for (let index = 384; index < 408; index += 1) {
      assert.ok(finalOwnership[index] > 0,
        `${kit}/layer-${index}: every landmark/support must influence final visible RGBA`);
    }
  }
});

test("A-prime compositor source cannot reach guides, authoring maps, patches, or actorless-world builders", {
  skip: API_SKIP,
}, async () => {
  const source = Function.prototype.toString.call(
    productionPacker.buildRegionalR5AtlasOnlyScenes,
  );
  for (const forbidden of [
    "REGIONAL_R5_AUTHORING_SOURCES",
    "REGIONAL_R5_CROPS",
    "REGIONAL_R5_KEY_SCENES",
    "buildRegionalR5KeyScene",
    "buildRegionalR5SourceMasters",
    ".fragments",
    ".patches",
    "actorless-world",
    "region-kits-imagegen-guide",
    "home-ruin-imagegen-guide",
  ]) {
    assert.equal(source.includes(forbidden), false,
      `atlas-only compositor reaches forbidden source ${forbidden}`);
  }
  assert.match(source, /masterBuffers/u, "encoded masters must be the compositor's raster boundary");
  assert.match(source, /placements/u, "closed placements must be the compositor's geometry boundary");

  const moduleSource = await readFile(ATLAS_ONLY_COMPOSITOR_MODULE, "utf8");
  const importedModules = [...moduleSource.matchAll(/\bfrom\s+["']([^"']+)["']/gu)]
    .map((match) => match[1]).sort(compareText);
  assert.deepEqual(importedModules, ["node:crypto", "sharp"],
    "actual compositor module imports must remain on the exact pure allowlist");
  for (const forbidden of [
    "REGIONAL_R5_AUTHORING_SOURCES",
    "REGIONAL_R5_CROPS",
    "REGIONAL_R5_KEY_SCENES",
    "REGIONAL_R5_LITERAL_PATCHES",
    "buildRegionalR5KeyScene",
    "buildRegionalR5SourceMasters",
    ".fragments",
    ".patches",
    "actorless-world",
    "region-kits-imagegen-guide",
    "home-ruin-imagegen-guide",
    "node:fs",
    "node:path",
    "node:url",
  ]) {
    assert.equal(moduleSource.includes(forbidden), false,
      `actual compositor module reaches forbidden source ${forbidden}`);
  }
});

test("A-prime rejects extra, missing, renamed, and tampered encoded master buffers", {
  skip: API_SKIP,
}, async () => {
  const input = await validInput();
  const missing = cloneBuffers(input.masterBuffers);
  delete missing[MASTER_NAMES[0]];
  await expectAtlasOnlyError({ ...input, masterBuffers: missing },
    "MASTER_INVENTORY_INVALID", /exactly 20.*master/iu);

  const extra = cloneBuffers(input.masterBuffers);
  extra["ash-waste-backdrop"] = Buffer.from(extra[MASTER_NAMES[0]]);
  await expectAtlasOnlyError({ ...input, masterBuffers: extra },
    "MASTER_INVENTORY_INVALID", /unexpected|extra|exactly 20/iu);

  const renamed = cloneBuffers(input.masterBuffers);
  renamed["ash-waste-landmark"] = renamed["ash-waste-landmarks"];
  delete renamed["ash-waste-landmarks"];
  await expectAtlasOnlyError({ ...input, masterBuffers: renamed },
    "MASTER_INVENTORY_INVALID", /renamed|missing|unexpected/iu);

  const tampered = cloneBuffers(input.masterBuffers);
  const stablePlacementSha256 = input.placements.canonicalSha256;
  assert.equal(Object.hasOwn(input.placements, "masterPngSha256"), false,
    "placement authority must not contain art-byte hashes");
  tampered["neutral-temperate-landmarks"][Math.floor(
    tampered["neutral-temperate-landmarks"].length / 2,
  )] ^= 0x01;
  assert.equal(productionPacker.regionalR5AtlasOnlyScenePlacements().canonicalSha256,
    stablePlacementSha256, "master-byte changes cannot redefine placement identity");
  await expectAtlasOnlyError({ ...input, masterBuffers: tampered },
    "MASTER_HASH_MISMATCH", /neutral-temperate-landmarks.*hash/iu);
});

test("A-prime rejects caller proof pixels and any non-contract top-level input", {
  skip: API_SKIP,
}, async () => {
  const input = await validInput();
  for (const [key, value] of [
    ["proofPixels", Buffer.alloc(768 * 512 * 4)],
    ["authoring", { fragments: new Map(), patches: new Map() }],
    ["sourceBuffers", { regionKits: Buffer.alloc(1), homeRuin: Buffer.alloc(1) }],
    ["actorlessWorld", Buffer.alloc(1)],
  ]) {
    await expectAtlasOnlyError({ ...input, [key]: value },
      "CALLER_SOURCE_FORBIDDEN", /only masterBuffers and placements|caller.*source/iu);
  }
});

test("A-prime rejects missing, renamed, extra, and tampered closed placements", {
  skip: API_SKIP,
}, async () => {
  const input = await validInput();
  const withoutDigest = structuredClone(input.placements);
  delete withoutDigest.canonicalSha256;
  await expectAtlasOnlyError({ ...input, placements: withoutDigest },
    "PLACEMENT_AUTHORITY_INVALID", /canonical|placement/iu);

  const renamed = structuredClone(input.placements);
  renamed.scenes["ash-industrial"] = renamed.scenes["ash-waste"];
  delete renamed.scenes["ash-waste"];
  await expectAtlasOnlyError({ ...input, placements: renamed },
    "PLACEMENT_AUTHORITY_INVALID", /kit|renamed|placement/iu);

  const extra = structuredClone(input.placements);
  extra.scenes["oracle-extra"] = extra.scenes["ash-waste"];
  await expectAtlasOnlyError({ ...input, placements: extra },
    "PLACEMENT_AUTHORITY_INVALID", /extra|kit|placement/iu);

  const tampered = structuredClone(input.placements);
  const firstLayer = tampered.scenes["worn-heartland"].visibleStaticLayers[0];
  firstLayer.destination.x += 1;
  await expectAtlasOnlyError({ ...input, placements: tampered },
    "PLACEMENT_AUTHORITY_INVALID", /canonical|hash|placement/iu);
});

test("A-prime leaves exact master bytes and closed placements unchanged", {
  skip: API_SKIP,
}, async () => {
  const input = await validInput();
  const masterBefore = canonicalDigest(Object.fromEntries(Object.entries(input.masterBuffers)
    .map(([name, buffer]) => [name, sha256(buffer)])));
  const placementsBefore = canonicalDigest(input.placements);
  await productionPacker.buildRegionalR5AtlasOnlyScenes(input);
  assert.equal(canonicalDigest(Object.fromEntries(Object.entries(input.masterBuffers)
    .map(([name, buffer]) => [name, sha256(buffer)]))), masterBefore,
  "compositor must not mutate encoded masters");
  assert.equal(canonicalDigest(input.placements), placementsBefore,
    "compositor must not mutate closed placements");
});
