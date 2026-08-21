/**
 * RED contract for the R5 A-prime dynamic presentation proof.
 *
 * The dynamic proof may consume only the already-composed 408-layer atlas-only
 * scenes and exact runtime masters. Rejected key-scene and complete-scene proof
 * pixels are never an input or an oracle here.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

import sharp from "sharp";

import {
  REGIONAL_R5_MECHANICS_BINDINGS,
  REGIONAL_R5_PALETTES,
} from "./regional-art-r5-authoring-spec.mjs";
import {
  REGIONAL_R5_DYNAMIC_LITERAL_PLACEMENTS,
  REGIONAL_R5_DYNAMIC_LITERAL_PLACEMENTS_SHA256,
} from "./fixtures/regional-art-r5-dynamic-literal-authority.mjs";
import * as productionPacker from "./pack-2d-production-assets.mjs";

const KITS = Object.freeze([
  "ash-waste",
  "dry-scrub",
  "neutral-temperate",
  "spring-terraces",
  "worn-heartland",
]);
const SCENE = Object.freeze({ width: 768, height: 512, channels: 4 });
const PAINTER_ORDER = Object.freeze([
  "static-atlas-only",
  "yard",
  "home-actor-back",
  "human-contact-shadows",
  "humans-feet-sorted",
  "home-actor-front",
]);
const DYNAMIC_API_EXPORTS = Object.freeze([
  "buildRegionalR5DynamicPresentationScenes",
  "regionalR5DynamicPresentationPlacements",
]);
const MISSING_DYNAMIC_API_EXPORTS = DYNAMIC_API_EXPORTS.filter((name) => (
  typeof productionPacker[name] !== "function"
));
const DYNAMIC_API_READY = MISSING_DYNAMIC_API_EXPORTS.length === 0;
const DYNAMIC_API_SKIP = DYNAMIC_API_READY
  ? false
  : `A_PRIME_DYNAMIC_RED/API_MISSING: ${MISSING_DYNAMIC_API_EXPORTS.join(", ")}`;
const DYNAMIC_MODULE = new URL("./regional-art-r5-dynamic-presentation.mjs", import.meta.url);
const REGION_GUIDE = new URL(
  "../../scratchpad/2d-production-art/source/imagegen-concepts/region-kits-imagegen-guide.png",
  import.meta.url,
);
const HOME_RUIN_GUIDE = new URL(
  "../../scratchpad/2d-production-art/source/imagegen-concepts/home-ruin-imagegen-guide.png",
  import.meta.url,
);
const NATIVE_SOURCE_ROOT = new URL("../../scratchpad/2d-production-art/source/native/", import.meta.url);
const PUBLICATION_ROOTS = Object.freeze([
  new URL("../public/assets/2d/", import.meta.url),
  NATIVE_SOURCE_ROOT,
  new URL("../../scratchpad/2d-production-art/evidence/", import.meta.url),
]);
const HUMAN_SLOTS = Object.freeze({
  "core-human-body-rigs": "core-human-body-rigs",
  "core-human-face-planes": "core-human-face-planes",
  "core-human-hair": "core-human-hair",
  "core-human-clothing-00": "core-human-clothing-00",
});
const SOURCE_GEOMETRY = Object.freeze({
  "core-human-body-rigs": Object.freeze({ width: 768, height: 1408, cellWidth: 48, cellHeight: 64 }),
  "core-human-face-planes": Object.freeze({ width: 768, height: 256, cellWidth: 48, cellHeight: 64 }),
  "core-human-hair": Object.freeze({ width: 768, height: 768, cellWidth: 48, cellHeight: 64 }),
  "core-human-clothing-00": Object.freeze({ width: 768, height: 704, cellWidth: 48, cellHeight: 64 }),
});

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort(compareText).map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

const canonicalDigest = (value) => sha256(Buffer.from(canonicalJson(value)));

function copyRaw(source) {
  return {
    data: Buffer.from(source.data),
    width: source.width,
    height: source.height,
    channels: source.channels,
  };
}

function sourceNames() {
  return [
    ...KITS.flatMap((kit) => [`${kit}-home-components`, `${kit}-home-yards`]),
    ...Object.keys(HUMAN_SLOTS),
  ].sort(compareText);
}

function sourceContract(name, masterBuffers) {
  if (name.endsWith("-home-yards")) {
    return {
      pngSha256: sha256(masterBuffers[name]),
      width: 960,
      height: 160,
      cellWidth: 192,
      cellHeight: 160,
    };
  }
  if (name.endsWith("-home-components")) {
    const kit = KITS.find((candidate) => name === `${candidate}-home-components`);
    const proof = REGIONAL_R5_MECHANICS_BINDINGS.visualProofBindings.homeActorProofs.kitProofs
      .find(({ kitId }) => kitId === kit);
    assert.ok(proof, `${name}: complete component authority is missing`);
    return {
      pngSha256: proof.componentAtlasPngSha256,
      width: proof.componentAtlasGeometry.width,
      height: proof.componentAtlasGeometry.height,
      cellWidth: 128,
      cellHeight: 128,
    };
  }
  const layer = REGIONAL_R5_MECHANICS_BINDINGS.productionHuman.layers
    .find(({ atlasId }) => atlasId === name);
  assert.ok(layer, `${name}: production-human authority is missing`);
  return {
    pngSha256: layer.atlasSha256,
    ...SOURCE_GEOMETRY[name],
  };
}

async function decodeSources(dynamicSourceBuffers, masterBuffers) {
  const decoded = {};
  for (const name of sourceNames()) {
    const bytes = dynamicSourceBuffers[name];
    const contract = sourceContract(name, masterBuffers);
    assert.ok(Buffer.isBuffer(bytes), `${name}: dynamic source must be encoded Buffer bytes`);
    assert.equal(sha256(bytes), contract.pngSha256, `${name}: exact PNG identity drift`);
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([info.width, info.height, info.channels],
      [contract.width, contract.height, 4], `${name}: exact decoded geometry drift`);
    decoded[name] = { data, width: info.width, height: info.height, channels: 4, contract };
  }
  return decoded;
}

function cropCell(source, cell) {
  const { cellWidth, cellHeight } = source.contract;
  const columns = source.width / cellWidth;
  assert.ok(Number.isSafeInteger(cell) && cell >= 0
    && cell < columns * (source.height / cellHeight), "source cell is out of range");
  const left = cell % columns * cellWidth;
  const top = Math.floor(cell / columns) * cellHeight;
  const data = Buffer.alloc(cellWidth * cellHeight * 4);
  for (let y = 0; y < cellHeight; y += 1) {
    const start = ((top + y) * source.width + left) * 4;
    source.data.copy(data, y * cellWidth * 4, start, start + cellWidth * 4);
  }
  return {
    raw: { data, width: cellWidth, height: cellHeight, channels: 4 },
    sourceRect: { x: left, y: top, width: cellWidth, height: cellHeight },
  };
}

function placeOpaque(destination, source, x, y) {
  for (let sourceY = 0; sourceY < source.height; sourceY += 1) {
    for (let sourceX = 0; sourceX < source.width; sourceX += 1) {
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const alpha = source.data[sourceOffset + 3];
      assert.ok(alpha === 0 || alpha === 255, "A-prime dynamic sources require binary alpha");
      if (alpha === 0) continue;
      const destinationX = x + sourceX;
      const destinationY = y + sourceY;
      if (destinationX < 0 || destinationY < 0
          || destinationX >= destination.width || destinationY >= destination.height) continue;
      source.data.copy(destination.data,
        (destinationY * destination.width + destinationX) * 4,
        sourceOffset,
        sourceOffset + 4);
    }
  }
}

function cropRaw(source, x, y, width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const start = ((y + row) * source.width + x) * 4;
    source.data.copy(data, row * width * 4, start, start + width * 4);
  }
  return { data, width, height, channels: 4 };
}

function independentHome(decoded, kit) {
  const construction = REGIONAL_R5_MECHANICS_BINDINGS.visualProofBindings
    .homeActorProofs.construction;
  const componentAtlas = decoded[`${kit}-home-components`];
  const groups = {};
  const sourceLayers = {};
  for (const group of ["back", "front"]) {
    const proof = {
      data: Buffer.alloc(construction.output.width * construction.output.height * 4),
      width: construction.output.width,
      height: construction.output.height,
      channels: 4,
    };
    sourceLayers[group] = [];
    for (const frame of construction.frameSequence.filter((candidate) => candidate.group === group)) {
      const cell = cropCell(componentAtlas, frame.index);
      placeOpaque(proof, cell.raw, construction.origin.x, construction.origin.y);
      sourceLayers[group].push({
        atlasId: `${kit}-home-components`,
        pngSha256: componentAtlas.contract.pngSha256,
        cell: frame.index,
        group,
        sourceRect: cell.sourceRect,
        sourceRgbaSha256: sha256(cell.raw.data),
      });
    }
    groups[group] = cropRaw(proof, construction.origin.x, construction.origin.y, 128, 128);
  }
  return { ...groups, sourceLayers };
}

function independentHuman(decoded) {
  const authority = REGIONAL_R5_MECHANICS_BINDINGS.productionHuman;
  const patch = { data: Buffer.alloc(48 * 64 * 4), width: 48, height: 64, channels: 4 };
  const sourceLayers = [];
  const semantic = {};
  for (const layer of authority.layers) {
    const source = decoded[HUMAN_SLOTS[layer.atlasId]];
    const cell = cropCell(source, layer.cellIndex);
    placeOpaque(patch, cell.raw, 0, 0);
    sourceLayers.push({
      atlasId: layer.atlasId,
      pngSha256: layer.atlasSha256,
      cell: layer.cellIndex,
      sourceRect: cell.sourceRect,
      sourceRgbaSha256: sha256(cell.raw.data),
    });
    if (layer.atlasId === "core-human-face-planes") semantic.face = cell.raw;
    if (layer.atlasId === "core-human-hair") semantic.hair = cell.raw;
  }
  assert.equal(sha256(patch.data), authority.canonicalPatchSha256,
    "independent human reconstruction must retain its canonical identity");
  assert.equal(sha256(semantic.face.data),
    REGIONAL_R5_MECHANICS_BINDINGS.entranceDepth.humanSemanticRgbaSha256.face);
  assert.equal(sha256(semantic.hair.data),
    REGIONAL_R5_MECHANICS_BINDINGS.entranceDepth.humanSemanticRgbaSha256.hair);
  return { patch, semantic, sourceLayers };
}

function contactShadowRaw(scenePlacement) {
  const authority = REGIONAL_R5_MECHANICS_BINDINGS.entranceDepth.contactShadow;
  const colorHex = REGIONAL_R5_PALETTES.shared[authority.colorToken];
  assert.match(colorHex, /^#[a-f0-9]{6}$/u);
  const color = [
    Number.parseInt(colorHex.slice(1, 3), 16),
    Number.parseInt(colorHex.slice(3, 5), 16),
    Number.parseInt(colorHex.slice(5, 7), 16),
    255,
  ];
  const raw = { data: Buffer.alloc(SCENE.width * SCENE.height * 4), ...SCENE };
  const instances = [];
  for (const humanPlacement of scenePlacement.humans) {
    const feet = {
      x: humanPlacement.destination.x + REGIONAL_R5_MECHANICS_BINDINGS.productionHuman.feet.x,
      y: humanPlacement.destination.y + REGIONAL_R5_MECHANICS_BINDINGS.productionHuman.feet.y,
    };
    const origin = { x: feet.x - authority.anchor.x, y: feet.y - authority.anchor.y };
    let opaquePixels = 0;
    for (let y = 0; y < authority.geometry.height; y += 1) {
      for (let x = 0; x < authority.geometry.width; x += 1) {
        if (authority.rows[y][x] === "0") continue;
        raw.data.set(color, ((origin.y + y) * raw.width + origin.x + x) * 4);
        opaquePixels += 1;
      }
    }
    assert.equal(opaquePixels, authority.geometry.opaquePixels);
    instances.push({ humanId: humanPlacement.id, feet, origin, opaquePixels });
  }
  return { raw, instances };
}

function maskedHomeFront(front, placement, homePlacement) {
  const authority = REGIONAL_R5_MECHANICS_BINDINGS.entranceDepth;
  const shelter = placement.humans.find(({ role }) => role === "shelter-door");
  assert.ok(shelter, "shelter-door witness is required");
  const relativeShelter = {
    x: shelter.destination.x - homePlacement.destination.x,
    y: shelter.destination.y - homePlacement.destination.y,
    width: shelter.destination.width,
    height: shelter.destination.height,
  };
  const apron = placement === REGIONAL_R5_DYNAMIC_LITERAL_PLACEMENTS.scenes["dry-scrub"]
    ? relativeShelter
    : authority.shelterDoorPresentationAnchor.apron;
  const output = { data: Buffer.alloc(front.data.length), width: front.width, height: front.height, channels: 4 };
  for (let y = 0; y < front.height; y += 1) for (let x = 0; x < front.width; x += 1) {
    const offset = (y * front.width + x) * 4;
    if (front.data[offset + 3] === 0) continue;
    const inPortal = x >= authority.portal.x && x < authority.portal.x + authority.portal.width
      && y >= authority.portal.y && y < authority.portal.y + authority.portal.height;
    const inThreshold = x >= authority.threshold.x && x < authority.threshold.x + authority.threshold.width
      && y >= authority.threshold.y && y < authority.threshold.y + authority.threshold.height;
    const inForegroundBand = x >= authority.thresholdForegroundBand.x
      && x < authority.thresholdForegroundBand.x + authority.thresholdForegroundBand.width
      && y >= authority.thresholdForegroundBand.y
      && y < authority.thresholdForegroundBand.y + authority.thresholdForegroundBand.height;
    const inApron = x >= apron.x && x < apron.x + apron.width
      && y >= apron.y && y < apron.y + apron.height;
    if ((inPortal || inApron) && !(inThreshold && inForegroundBand)) continue;
    front.data.copy(output.data, offset, offset, offset + 4);
  }
  return output;
}

async function dynamicSources(masterBuffers) {
  const buffers = {};
  for (const kit of KITS) {
    buffers[`${kit}-home-yards`] = Buffer.from(masterBuffers[`${kit}-home-yards`]);
    buffers[`${kit}-home-components`] = await readFile(
      new URL(`homes/${kit}/components.png`, NATIVE_SOURCE_ROOT),
    );
  }
  for (const name of Object.keys(HUMAN_SLOTS)) {
    buffers[name] = await readFile(new URL(`core/${name.replace(/^core-human-/u, "human-")}.png`, NATIVE_SOURCE_ROOT));
  }
  assert.deepEqual(Object.keys(buffers).sort(compareText), sourceNames());
  return buffers;
}

let validInputPromise;
async function validInput() {
  validInputPromise ??= (async () => {
    const authoring = await productionPacker.buildRegionalR5SourceMasters({
      sourceBuffers: {
        regionKits: await readFile(REGION_GUIDE),
        homeRuin: await readFile(HOME_RUIN_GUIDE),
      },
    });
    const masterBuffers = Object.fromEntries(Object.entries(authoring.buffers)
      .map(([name, bytes]) => [name, Buffer.from(bytes)]));
    const staticScenes = await productionPacker.buildRegionalR5AtlasOnlyScenes({
      masterBuffers,
      placements: productionPacker.regionalR5AtlasOnlyScenePlacements(),
    });
    return {
      staticScenes,
      dynamicSourceBuffers: await dynamicSources(masterBuffers),
      placements: productionPacker.regionalR5DynamicPresentationPlacements(),
      masterBuffers,
    };
  })();
  return validInputPromise;
}

function independentScene(staticRaw, decoded, kit) {
  const placement = REGIONAL_R5_DYNAMIC_LITERAL_PLACEMENTS.scenes[kit];
  const output = copyRaw(staticRaw);
  const yardCell = cropCell(decoded[`${kit}-home-yards`], placement.yard.cell);
  const home = independentHome(decoded, kit);
  const human = independentHuman(decoded);
  const shadows = contactShadowRaw(placement);
  const maskedFront = maskedHomeFront(home.front, placement, placement.homeActor);
  placeOpaque(output, yardCell.raw, placement.yard.destination.x, placement.yard.destination.y);
  placeOpaque(output, home.back, placement.homeActor.destination.x, placement.homeActor.destination.y);
  placeOpaque(output, shadows.raw, 0, 0);
  const humans = placement.humans.map((candidate) => ({
    ...candidate,
    feet: {
      x: candidate.destination.x + REGIONAL_R5_MECHANICS_BINDINGS.productionHuman.feet.x,
      y: candidate.destination.y + REGIONAL_R5_MECHANICS_BINDINGS.productionHuman.feet.y,
    },
  })).sort((left, right) => left.feet.y - right.feet.y
    || left.feet.x - right.feet.x || compareText(left.id, right.id));
  for (const witness of humans) {
    placeOpaque(output, human.patch, witness.destination.x, witness.destination.y);
  }
  placeOpaque(output, maskedFront, placement.homeActor.destination.x, placement.homeActor.destination.y);
  return { output, yardCell, home, human, shadows, maskedFront, humans };
}

async function publicationSnapshot() {
  const files = [];
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
      if (metadata.isDirectory()) await visit(new URL(`${name}/`, url), `${prefix}/${name}`);
      else files.push([`${prefix}/${name}`, sha256(await readFile(child))]);
    }
  };
  for (const [index, root] of PUBLICATION_ROOTS.entries()) await visit(root, String(index));
  return canonicalDigest(files);
}

test("RED A-prime exports the separate dynamic presentation compositor and placement authority", () => {
  assert.deepEqual(
    MISSING_DYNAMIC_API_EXPORTS,
    [],
    `A_PRIME_DYNAMIC_RED/API_MISSING: ${MISSING_DYNAMIC_API_EXPORTS.join(", ")}`,
  );
});

test("A-prime dynamic placements equal the independent five-kit literal authority", {
  skip: DYNAMIC_API_SKIP,
}, () => {
  const expectedDigest = canonicalDigest(REGIONAL_R5_DYNAMIC_LITERAL_PLACEMENTS);
  assert.equal(expectedDigest, REGIONAL_R5_DYNAMIC_LITERAL_PLACEMENTS_SHA256,
    "test-only dynamic placement fixture identity drift");
  assert.deepEqual(productionPacker.regionalR5DynamicPresentationPlacements(), {
    ...REGIONAL_R5_DYNAMIC_LITERAL_PLACEMENTS,
    canonicalSha256: expectedDigest,
  });
});

test("A-prime dynamic proof composes exact sources in the reviewed painter order", {
  skip: DYNAMIC_API_SKIP,
}, async () => {
  const input = await validInput();
  const decoded = await decodeSources(input.dynamicSourceBuffers, input.masterBuffers);
  const result = await productionPacker.buildRegionalR5DynamicPresentationScenes({
    staticScenes: input.staticScenes,
    dynamicSourceBuffers: input.dynamicSourceBuffers,
    placements: input.placements,
  });
  assert.equal(result.schema, "regional-r5-dynamic-presentation-scenes/v1");
  assert.equal(result.atlasOnlyStatic, true);
  assert.equal(result.published, false);
  assert.equal(result.placementSha256, input.placements.canonicalSha256);
  assert.deepEqual(result.sourceNames, sourceNames());
  assert.deepEqual(Object.keys(result.scenes).sort(compareText), KITS);

  for (const kit of KITS) {
    const scene = result.scenes[kit];
    const staticScene = input.staticScenes.scenes[kit];
    const oracle = independentScene(staticScene.raw, decoded, kit);
    assert.deepEqual(scene.painterOrder, PAINTER_ORDER, `${kit}: exact painter order`);
    assert.deepEqual([scene.raw.width, scene.raw.height, scene.raw.channels], [768, 512, 4]);
    assert.equal(scene.raw.data.length, 768 * 512 * 4);
    assert.equal(scene.rgbaSha256, sha256(scene.raw.data));
    assert.deepEqual(scene.raw.data, oracle.output.data,
      `${kit}: final pixels must equal the independent static-to-front flatten`);
    assert.equal(scene.static.rgbaSha256, staticScene.rgbaSha256);
    assert.equal(scene.static.visibleLayerCount, 408);
    assert.deepEqual(scene.static.visibleLayerIds,
      staticScene.visibleStaticLayers.map(({ id }) => id));
    assert.equal(scene.dynamic.yard.patchRgbaSha256, sha256(oracle.yardCell.raw.data));
    assert.deepEqual(scene.dynamic.yard.placement,
      REGIONAL_R5_DYNAMIC_LITERAL_PLACEMENTS.scenes[kit].yard);
    assert.equal(scene.dynamic.homeActor.backPatchRgbaSha256, sha256(oracle.home.back.data));
    assert.equal(scene.dynamic.homeActor.frontPatchRgbaSha256, sha256(oracle.maskedFront.data));
    assert.deepEqual(scene.dynamic.homeActor.backSourceLayers, oracle.home.sourceLayers.back);
    assert.deepEqual(scene.dynamic.homeActor.frontSourceLayers, oracle.home.sourceLayers.front);
    assert.deepEqual(scene.dynamic.humans.map(({ id }) => id), oracle.humans.map(({ id }) => id),
      `${kit}: humans must be feet-sorted before painting`);
    assert.deepEqual(scene.dynamic.contactShadows.instances, oracle.shadows.instances);
  }
});

test("A-prime dynamic receipts contain exact yard, HomeActor, human, face, hair, and shadow provenance", {
  skip: DYNAMIC_API_SKIP,
}, async () => {
  const input = await validInput();
  const decoded = await decodeSources(input.dynamicSourceBuffers, input.masterBuffers);
  const result = await productionPacker.buildRegionalR5DynamicPresentationScenes({
    staticScenes: input.staticScenes,
    dynamicSourceBuffers: input.dynamicSourceBuffers,
    placements: input.placements,
  });
  for (const kit of KITS) {
    const scene = result.scenes[kit];
    const oracle = independentScene(input.staticScenes.scenes[kit].raw, decoded, kit);
    assert.deepEqual(scene.dynamic.yard.provenance, {
      atlasId: `${kit}-home-yards`,
      pngSha256: decoded[`${kit}-home-yards`].contract.pngSha256,
      cell: 0,
      sourceRect: oracle.yardCell.sourceRect,
      sourceRgbaSha256: sha256(oracle.yardCell.raw.data),
    });
    assert.equal(scene.dynamic.humans.length, 3);
    for (const witness of scene.dynamic.humans) {
      assert.equal(witness.patchRgbaSha256,
        REGIONAL_R5_MECHANICS_BINDINGS.productionHuman.canonicalPatchSha256);
      assert.equal(witness.facePatchRgbaSha256,
        REGIONAL_R5_MECHANICS_BINDINGS.entranceDepth.humanSemanticRgbaSha256.face);
      assert.equal(witness.hairPatchRgbaSha256,
        REGIONAL_R5_MECHANICS_BINDINGS.entranceDepth.humanSemanticRgbaSha256.hair);
      assert.deepEqual(witness.sourceLayers, oracle.human.sourceLayers);
      assert.equal(witness.sourceLayers.filter(({ atlasId }) => atlasId === "core-human-face-planes").length, 1);
      assert.equal(witness.sourceLayers.filter(({ atlasId }) => atlasId === "core-human-hair").length, 1);
      assert.equal(witness.sourceLayers.some(({ atlasId }) => /held/iu.test(atlasId)), false);
    }
    assert.equal(scene.dynamic.contactShadows.instances.length, 3);
    assert.ok(scene.dynamic.contactShadows.instances.every(({ opaquePixels }) => (
      opaquePixels === REGIONAL_R5_MECHANICS_BINDINGS.entranceDepth.contactShadow.geometry.opaquePixels
    )));
    const shadowAuthority = REGIONAL_R5_MECHANICS_BINDINGS.entranceDepth.contactShadow;
    assert.deepEqual(scene.dynamic.contactShadows.provenance, {
      sourceKind: "mechanics-authority",
      geometry: shadowAuthority.geometry,
      rows: shadowAuthority.rows,
      anchor: shadowAuthority.anchor,
      colorToken: shadowAuthority.colorToken,
      colorRgba: [31, 29, 38, 255],
      authoritySha256: canonicalDigest({
        geometry: shadowAuthority.geometry,
        rows: shadowAuthority.rows,
        anchor: shadowAuthority.anchor,
        colorToken: shadowAuthority.colorToken,
        colorRgba: [31, 29, 38, 255],
      }),
    }, `${kit}: generated shadow pixels require exact mechanics provenance`);
  }
});

test("A-prime keeps every dynamic actor out of the 408-layer static receipt", {
  skip: DYNAMIC_API_SKIP,
}, async () => {
  const input = await validInput();
  const result = await productionPacker.buildRegionalR5DynamicPresentationScenes({
    staticScenes: input.staticScenes,
    dynamicSourceBuffers: input.dynamicSourceBuffers,
    placements: input.placements,
  });
  for (const kit of KITS) {
    const staticScene = input.staticScenes.scenes[kit];
    const scene = result.scenes[kit];
    assert.equal(staticScene.visibleStaticLayers.length, 408);
    assert.deepEqual(scene.static.visibleLayerIds,
      staticScene.visibleStaticLayers.map(({ id }) => id));
    const serializedStaticReceipt = canonicalJson(staticScene.visibleStaticLayers);
    for (const forbidden of [
      "home-yards",
      "home-components",
      "human-body",
      "human-face",
      "human-hair",
      "human-clothing",
      "contact-shadow",
    ]) assert.equal(serializedStaticReceipt.includes(forbidden), false,
      `${kit}: ${forbidden} must remain dynamic-only`);
    const dynamicIds = [
      scene.dynamic.yard.placement.id,
      scene.dynamic.homeActor.placement.id,
      ...scene.dynamic.humans.map(({ id }) => id),
    ];
    assert.equal(dynamicIds.some((id) => scene.static.visibleLayerIds.includes(id)), false);
    assert.equal(scene.static.rgbaSha256, sha256(staticScene.raw.data));
  }
});

test("A-prime renders exactly three coherent non-overlapping one-face humans per kit", {
  skip: DYNAMIC_API_SKIP,
}, async () => {
  const input = await validInput();
  const decoded = await decodeSources(input.dynamicSourceBuffers, input.masterBuffers);
  const result = await productionPacker.buildRegionalR5DynamicPresentationScenes({
    staticScenes: input.staticScenes,
    dynamicSourceBuffers: input.dynamicSourceBuffers,
    placements: input.placements,
  });
  for (const kit of KITS) {
    const scene = result.scenes[kit];
    const human = independentHuman(decoded);
    assert.equal(scene.dynamic.humans.length, 3);
    assert.equal(new Set(scene.dynamic.humans.map(({ id }) => id)).size, 3);
    for (let left = 0; left < scene.dynamic.humans.length; left += 1) {
      const a = scene.dynamic.humans[left].placement.destination;
      assert.deepEqual({ width: a.width, height: a.height }, { width: 48, height: 64 });
      for (let right = left + 1; right < scene.dynamic.humans.length; right += 1) {
        const b = scene.dynamic.humans[right].placement.destination;
        assert.equal(a.x < b.x + b.width && b.x < a.x + a.width
          && a.y < b.y + b.height && b.y < a.y + a.height, false,
        `${kit}: human ${left}/${right} boxes may not overlap into duplicate faces`);
      }
      for (const semantic of [human.semantic.face, human.semantic.hair]) {
        for (let y = 0; y < semantic.height; y += 1) for (let x = 0; x < semantic.width; x += 1) {
          const sourceOffset = (y * semantic.width + x) * 4;
          if (semantic.data[sourceOffset + 3] === 0) continue;
          const destinationOffset = ((a.y + y) * scene.raw.width + a.x + x) * 4;
          assert.deepEqual(scene.raw.data.subarray(destinationOffset, destinationOffset + 4),
            human.patch.data.subarray(sourceOffset, sourceOffset + 4),
          `${kit}: HomeActor front may not overwrite face/hair pixels`);
        }
      }
    }
  }
});

test("A-prime dynamic compositor cannot reach guides, direct scenes, backdrops, fragments, or publication", {
  skip: DYNAMIC_API_SKIP,
}, async () => {
  const input = await validInput();
  const before = await publicationSnapshot();
  const result = await productionPacker.buildRegionalR5DynamicPresentationScenes({
    staticScenes: input.staticScenes,
    dynamicSourceBuffers: input.dynamicSourceBuffers,
    placements: input.placements,
  });
  assert.equal(result.published, false);
  assert.equal(await publicationSnapshot(), before,
    "dynamic proof composition must not publish or mutate source/evidence files");
  const source = Function.prototype.toString.call(
    productionPacker.buildRegionalR5DynamicPresentationScenes,
  );
  for (const forbidden of [
    "REGIONAL_R5_KEY_SCENES",
    "buildRegionalR5KeyScene",
    "buildRegionalR5CompleteProofScene",
    "actorless-world",
    "backdrop",
    "fragment",
    "region-kits-imagegen-guide",
    "home-ruin-imagegen-guide",
  ]) assert.equal(source.includes(forbidden), false,
    `dynamic compositor reaches forbidden source ${forbidden}`);

  const moduleSource = await readFile(DYNAMIC_MODULE, "utf8");
  const imports = [...moduleSource.matchAll(/\bfrom\s+["']([^"']+)["']/gu)]
    .map((match) => match[1]).sort(compareText);
  assert.deepEqual(imports, ["node:crypto", "sharp"],
    "dynamic compositor module imports must remain on the pure allowlist");
  for (const forbidden of [
    "REGIONAL_R5_KEY_SCENES",
    "buildRegionalR5KeyScene",
    "buildRegionalR5CompleteProofScene",
    "buildRegionalR5SourceMasters",
    "actorless-world",
    "backdrop",
    "fragment",
    "patchId",
    "region-kits-imagegen-guide",
    "home-ruin-imagegen-guide",
    "node:fs",
    "node:path",
    "node:url",
  ]) assert.equal(moduleSource.includes(forbidden), false,
    `dynamic compositor module reaches forbidden source ${forbidden}`);
});

test("A-prime dynamic compositor fails closed on caller pixels and source inventory drift", {
  skip: DYNAMIC_API_SKIP,
}, async () => {
  const input = await validInput();
  for (const [key, value] of [
    ["guidePixels", Buffer.alloc(4)],
    ["actorlessWorld", Buffer.alloc(768 * 512 * 4)],
    ["backdrop", Buffer.alloc(4)],
    ["fragments", new Map()],
  ]) {
    await assert.rejects(
      productionPacker.buildRegionalR5DynamicPresentationScenes({
        staticScenes: input.staticScenes,
        dynamicSourceBuffers: input.dynamicSourceBuffers,
        placements: input.placements,
        [key]: value,
      }),
      (error) => error?.name === "RegionalR5DynamicPresentationError"
        && error?.code === "CALLER_SOURCE_FORBIDDEN",
      `${key}: caller-provided direct pixels must fail closed`,
    );
  }
  const missing = { ...input.dynamicSourceBuffers };
  delete missing["core-human-face-planes"];
  await assert.rejects(
    productionPacker.buildRegionalR5DynamicPresentationScenes({
      staticScenes: input.staticScenes,
      dynamicSourceBuffers: missing,
      placements: input.placements,
    }),
    (error) => error?.name === "RegionalR5DynamicPresentationError"
      && error?.code === "DYNAMIC_SOURCE_INVENTORY_INVALID",
  );
});
