import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import sharp from "sharp";

import {
  cleanupChroma,
  composeTerrainProof,
  packHumanLayers,
  packShelterAtlas,
  packTileAtlas,
  repairProductionBody,
  repairProductionOverlay,
  repairProductionShelter,
  repairProductionTiles,
  scanChromaResidue,
  TILE_INVENTORY,
  validateOverlayAlignment,
  validateHeldInventory,
  validateDirectionalBodyInventory,
  validateDirectionalFaceInventory,
  validateTileArt,
  validateOccupancy,
  validateTransitionSeams,
  writeContactSheet,
} from "./pack-2d-slice-assets.mjs";

const png = (width, height, background) =>
  sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

test("packs a 128px tile to native 32px with nearest-neighbor identity", async () => {
  const source = await sharp({
    create: { width: 128, height: 128, channels: 4, background: "#ff0000" },
  })
    .composite([{ input: await png(64, 128, { r: 0, g: 0, b: 255, alpha: 1 }), left: 64, top: 0 }])
    .png()
    .toBuffer();
  const atlas = await packTileAtlas(source, { columns: 1, rows: 1, cellWidth: 128, cellHeight: 128 });
  const { data, info } = await sharp(atlas).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [32, 32]);
  assert.deepEqual([...data.subarray(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...data.subarray((31 * 4), (31 * 4) + 3)], [0, 0, 255]);
});

test("center-crops a 96x128 human without anisotropic scaling and preserves alpha corners", async () => {
  const transparent = await png(128, 128, { r: 0, g: 0, b: 0, alpha: 0 });
  const body = await sharp(transparent)
    .composite([{ input: await png(80, 112, "#4f683f"), left: 24, top: 8 }])
    .png()
    .toBuffer();
  const overlay = await png(96, 128, { r: 0, g: 0, b: 0, alpha: 0 });
  const packed = await packHumanLayers({
    bodySource: body,
    faceSource: overlay,
    heldSource: overlay,
    bodyGrid: { columns: 1, rows: 1, cellWidth: 128, cellHeight: 128 },
    overlayGrid: { columns: 1, rows: 1, cellWidth: 96, cellHeight: 128 },
  });
  const { data, info } = await sharp(packed.body).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [48, 64]);
  assert.equal(data[3], 0);
  assert.equal(data[data.length - 1], 0);
  assert.equal(info.width / info.height, 48 / 64);
});

test("preserves exact isotropic nearest-neighbor pixel blocks in a centered human crop", async () => {
  const raw = Buffer.alloc(96 * 128 * 4);
  for (let y = 0; y < 128; y += 1) for (let x = 0; x < 96; x += 1) {
    const index = (y * 96 + x) * 4;
    raw[index] = Math.floor(x / 2) % 2 ? 240 : 15; raw[index + 1] = Math.floor(y / 2) % 2 ? 210 : 25; raw[index + 2] = 60; raw[index + 3] = 255;
  }
  const crop = await sharp(raw, { raw: { width: 96, height: 128, channels: 4 } }).png().toBuffer();
  const body = await sharp({ create: { width: 128, height: 128, channels: 4, background: transparent } })
    .composite([{ input: crop, left: 16, top: 0 }]).png().toBuffer();
  const packed = await packHumanLayers({ bodySource: body, faceSource: crop, heldSource: crop,
    bodyGrid: { columns: 1, rows: 1, cellWidth: 128, cellHeight: 128 }, overlayGrid: { columns: 1, rows: 1, cellWidth: 96, cellHeight: 128 } });
  const sourceRaw = await sharp(crop).ensureAlpha().raw().toBuffer(); const packedRaw = await sharp(packed.body).ensureAlpha().raw().toBuffer();
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 48; x += 1) {
    const packedIndex = (y * 48 + x) * 4; const sourceIndex = ((y * 2) * 96 + x * 2) * 4;
    assert.deepEqual([...packedRaw.subarray(packedIndex, packedIndex + 3)], [...sourceRaw.subarray(sourceIndex, sourceIndex + 3)]);
    assert.ok(packedRaw[packedIndex + 3] > 0, "opaque source pixels remain occupied after palette encoding");
  }
});

test("removes dark chroma blends and despills edges without erasing the approved rust palette", async () => {
  const source = await sharp(Buffer.from([
    255, 0, 255, 255, 148, 22, 151, 255, 128, 45, 126, 255, 150, 70, 110, 255, 170, 80, 95, 255,
  ]), { raw: { width: 5, height: 1, channels: 4 } }).png().toBuffer();
  assert.equal((await scanChromaResidue(source)).count, 3);
  const cleaned = await cleanupChroma(source);
  const pixels = await sharp(cleaned).raw().toBuffer();
  assert.equal(pixels[3], 0);
  assert.equal(pixels[7], 0);
  assert.equal(pixels[11], 0);
  assert.deepEqual([...pixels.subarray(12, 16)], [110, 70, 70, 255], "adjacent moderate spill is neutralized without deleting the edge");
  assert.deepEqual([...pixels.subarray(16, 20)], [170, 80, 95, 255]);
  assert.equal((await scanChromaResidue(cleaned)).count, 0);
});

test("production repairs reject wrong dimensions and malformed layouts instead of returning blanks", async () => {
  const wrong = await png(64, 64, "#ff00ff");
  await assert.rejects(repairProductionTiles(wrong), /tile source.*1254x1254/i);
  await assert.rejects(repairProductionBody(wrong), /body source.*1536x1024/i);
  await assert.rejects(repairProductionOverlay("face", wrong), /face source.*1536x1024/i);
  await assert.rejects(repairProductionOverlay("held", wrong), /held source.*1774x887/i);
  await assert.rejects(repairProductionShelter(wrong), /shelter source.*1254x1254/i);
  const emptyBody = await png(1536, 1024, "#ff00ff");
  await assert.rejects(repairProductionBody(emptyBody), /reviewed body source fingerprint/i);
});

test("rejects same-size white and one-pixel-mutated reviewed tile sources", async () => {
  const reviewed = await readFile("scratchpad/2d-slice-art-source/nirvana-tiles-source.png");
  const white = await png(1254, 1254, "#ffffff");
  await assert.rejects(repairProductionTiles(white), /reviewed tile source fingerprint/i);

  const { data, info } = await sharp(reviewed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  data[0] = (data[0] + 1) % 256;
  const mutated = await sharp(data, { raw: info }).png().toBuffer();
  await assert.rejects(repairProductionTiles(mutated), /reviewed tile source fingerprint/i);
});

test("rejects same-size white and one-pixel-mutated reviewed overlay sources", async () => {
  const reviewed = await readFile("scratchpad/2d-slice-art-source/human-held-source-raw.png");
  const white = await png(1774, 887, "#ffffff");
  await assert.rejects(repairProductionOverlay("held", white), /reviewed held source fingerprint/i);

  const { data, info } = await sharp(reviewed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = Math.floor(info.width * info.height / 2) * 4;
  data[pixel] = (data[pixel] + 1) % 256;
  const mutated = await sharp(data, { raw: info }).png().toBuffer();
  await assert.rejects(repairProductionOverlay("held", mutated), /reviewed held source fingerprint/i);
});

test("rejects same-size white and one-pixel-mutated reviewed body sources", async () => {
  const reviewed = await readFile("scratchpad/2d-slice-art-source/human-body-source-raw.png");
  const white = await png(1536, 1024, "#ffffff");
  await assert.rejects(repairProductionBody(white), /reviewed body source fingerprint/i);

  const { data, info } = await sharp(reviewed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = Math.floor(info.width * info.height / 2) * 4;
  data[pixel] = (data[pixel] + 1) % 256;
  const mutated = await sharp(data, { raw: info }).png().toBuffer();
  await assert.rejects(repairProductionBody(mutated), /reviewed body source fingerprint/i);
});

test("repairs the actual production sources into strict packer inputs", async () => {
  const base = "scratchpad/2d-slice-art-source";
  const [bodyRaw, faceRaw, heldRaw, tileRaw, shelterRaw] = await Promise.all([
    readFile(`${base}/human-body-source-raw.png`), readFile(`${base}/human-face-source-raw.png`),
    readFile(`${base}/human-held-source-raw.png`), readFile(`${base}/nirvana-tiles-source.png`),
    readFile(`${base}/shelter-components-source-raw.png`),
  ]);
  const [bodySource, faceSource, heldSource, tileSource, shelterSource] = await Promise.all([
    repairProductionBody(bodyRaw), repairProductionOverlay("face", faceRaw), repairProductionOverlay("held", heldRaw),
    repairProductionTiles(tileRaw), repairProductionShelter(shelterRaw),
  ]);
  const bodyMeta = await sharp(bodySource).metadata();
  assert.deepEqual([bodyMeta.width, bodyMeta.height], [1792, 1024]);
  assert.deepEqual([(await sharp(faceSource).metadata()).width, (await sharp(faceSource).metadata()).height], [768, 512]);
  assert.deepEqual([(await sharp(heldSource).metadata()).width, (await sharp(heldSource).metadata()).height], [768, 128]);
  assert.deepEqual([(await sharp(tileSource).metadata()).width, (await sharp(tileSource).metadata()).height], [1024, 1024]);
  assert.deepEqual([(await sharp(shelterSource).metadata()).width, (await sharp(shelterSource).metadata()).height], [1280, 1024]);
  const human = await packHumanLayers({ bodySource, faceSource, heldSource,
    bodyGrid: { columns: 14, rows: 8, cellWidth: 128, cellHeight: 128 },
    faceGrid: { columns: 8, rows: 4, cellWidth: 96, cellHeight: 128 },
    overlayGrid: { columns: 8, rows: 1, cellWidth: 96, cellHeight: 128 } });
  const walkFrames = [4, 5, 6, 7, 8, 9, 18, 19, 20, 21, 22, 23, 32, 33, 34, 35, 36, 37, 46, 47, 48, 49, 50, 51];
  const bodyOccupancy = await validateOccupancy(human.body, { cellWidth: 48, cellHeight: 64, columns: 14, rows: 8, frameIndices: walkFrames, gutter: 1 });
  assert.equal(bodyOccupancy.cellOverflow, false); assert.ok(bodyOccupancy.maxFeetDrift <= 2);
  const directionalFace = await validateDirectionalFaceInventory(human.face);
  assert.deepEqual(directionalFace.issues, []);
  assert.equal(directionalFace.northOpaquePixels, 0);
  assert.equal(directionalFace.mirroredProfiles, true);
  assert.equal(directionalFace.cells.length, 32);
  const northOpaque = await sharp(human.face).composite([{ input: await png(1, 1, "#10060b"), left: 20, top: 148 }]).png().toBuffer();
  assert.ok((await validateDirectionalFaceInventory(northOpaque)).issues.some((issue) => /north.*transparent/i.test(issue)));
  const fullHead = await sharp(human.face).composite([{ input: await png(24, 24, "#f3ad6e"), left: 12, top: 16 }]).png().toBuffer();
  assert.ok((await validateDirectionalFaceInventory(fullHead)).issues.some((issue) => /full-head-sized/i.test(issue)));
  const shelter = await packShelterAtlas(shelterSource, { columns: 5, rows: 4, cellWidth: 256, cellHeight: 256 });
  const shelterOccupancy = await validateOccupancy(shelter, { cellWidth: 128, cellHeight: 128, columns: 5, rows: 4, gutter: 2, expectedEmpty: [19] });
  assert.equal(shelterOccupancy.cellOverflow, false); assert.deepEqual(shelterOccupancy.unexpectedOccupied, []);
});

test("exports direction-aware face QA for generated runtime assets", async () => {
  const packer = await import("./pack-2d-slice-assets.mjs");
  assert.equal(typeof packer.validateDirectionalFaceInventory, "function");
});

test("authors a complete distinct 4 idle, 6 walk, 2 turn, 2 stop inventory in every direction", async () => {
  const raw = await readFile("scratchpad/2d-slice-art-source/human-body-source-raw.png");
  const strict = await repairProductionBody(raw);
  const packed = await packHumanLayers({ bodySource: strict, faceSource: await png(768, 128, transparent), heldSource: await png(768, 128, transparent),
    bodyGrid: { columns: 14, rows: 8, cellWidth: 128, cellHeight: 128 }, overlayGrid: { columns: 8, rows: 1, cellWidth: 96, cellHeight: 128 } });
  assert.deepEqual([(await sharp(packed.body).metadata()).width, (await sharp(packed.body).metadata()).height], [672, 512]);

  const cellRaw = (row, column) => sharp(packed.body)
    .extract({ left: column * 48, top: row * 64, width: 48, height: 64 })
    .ensureAlpha().raw().toBuffer();
  for (let row = 0; row < 4; row += 1) {
    const cells = await Promise.all(Array.from({ length: 14 }, (_, column) => cellRaw(row, column)));
    const hashes = cells.map((cell) => createHash("sha256").update(cell).digest("hex"));
    assert.equal(new Set(hashes).size, 14, `direction row ${row} must contain fourteen genuinely distinct frames`);
    for (let left = 0; left < cells.length; left += 1) for (let right = left + 1; right < cells.length; right += 1) {
      let alphaDelta = 0;
      for (let offset = 3; offset < cells[left].length; offset += 4) if (cells[left][offset] !== cells[right][offset]) alphaDelta += 1;
      assert.ok(alphaDelta >= 16, `direction row ${row} frames ${left}/${right} differ by only ${alphaDelta} alpha pixels`);
    }
  }
  const occupancy = await validateOccupancy(packed.body, {
    cellWidth: 48, cellHeight: 64, columns: 14, rows: 8,
    frameIndices: Array.from({ length: 56 }, (_, index) => index), gutter: 1,
  });
  assert.equal(occupancy.cellOverflow, false);
  assert.deepEqual(occupancy.unexpectedEmpty, []);
  assert.ok(occupancy.maxFeetDrift <= 2);
});

test("removes detached previous-row fragments and keeps directional idle body scale consistent", async () => {
  const raw = await readFile("scratchpad/2d-slice-art-source/human-body-source-raw.png");
  const strict = await repairProductionBody(raw);
  const packed = await packHumanLayers({ bodySource: strict, faceSource: await png(768, 128, transparent), heldSource: await png(768, 128, transparent),
    bodyGrid: { columns: 14, rows: 8, cellWidth: 128, cellHeight: 128 }, overlayGrid: { columns: 8, rows: 1, cellWidth: 96, cellHeight: 128 } });
  const proof = await validateDirectionalBodyInventory(packed.body);

  assert.deepEqual(proof.detachedUpperComponents, []);
  assert.equal(proof.idleMainHeights.length, 4);
  assert.ok(proof.maxIdleHeightDrift <= 2, `directional idle main-body height drift is ${proof.maxIdleHeightDrift}px`);
});

test("keeps reach and recovery art distinct from directional locomotion after widening the body atlas", async () => {
  const raw = await readFile("scratchpad/2d-slice-art-source/human-body-source-raw.png");
  const strict = await repairProductionBody(raw);
  const packed = await packHumanLayers({ bodySource: strict, faceSource: await png(768, 128, transparent), heldSource: await png(768, 128, transparent),
    bodyGrid: { columns: 14, rows: 8, cellWidth: 128, cellHeight: 128 }, overlayGrid: { columns: 8, rows: 1, cellWidth: 96, cellHeight: 128 } });
  const hash = async (row, column) => createHash("sha256").update(await sharp(packed.body).extract({ left: column * 48, top: row * 64, width: 48, height: 64 }).raw().toBuffer()).digest("hex");
  for (let column = 0; column < 4; column += 1) {
    assert.notEqual(await hash(4, column), await hash(0, column), `reach frame ${column} must not duplicate south locomotion`);
    assert.notEqual(await hash(6, column), await hash(0, column), `recovery frame ${column} must not duplicate south locomotion`);
  }
});

test("keeps face and held overlays in the shared body coordinate space", async () => {
  const base = "scratchpad/2d-slice-art-source";
  const [bodyRaw, faceRaw, heldRaw] = await Promise.all([readFile(`${base}/human-body-source-raw.png`), readFile(`${base}/human-face-source-raw.png`), readFile(`${base}/human-held-source-raw.png`)]);
  const [bodySource, faceSource, heldSource] = await Promise.all([repairProductionBody(bodyRaw), repairProductionOverlay("face", faceRaw), repairProductionOverlay("held", heldRaw)]);
  const human = await packHumanLayers({ bodySource, faceSource, heldSource,
    bodyGrid: { columns: 14, rows: 8, cellWidth: 128, cellHeight: 128 },
    faceGrid: { columns: 8, rows: 4, cellWidth: 96, cellHeight: 128 },
    overlayGrid: { columns: 8, rows: 1, cellWidth: 96, cellHeight: 128 } });
  const proof = await validateOverlayAlignment(human.body, human.face, human.held);
  assert.deepEqual(proof.issues, []);
  assert.ok(proof.faceBounds.width <= 20 && proof.faceBounds.maxY < 34);
  assert.ok(proof.heldBounds.width <= 34 && proof.heldBounds.height <= 30);
  assert.deepEqual([(await sharp(proof.composite).metadata()).width, (await sharp(proof.composite).metadata()).height], [288, 64]);
  assert.deepEqual(proof.heldFrames.map(({ frame }) => frame), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual((await validateHeldInventory(human.held)).issues, []);
});

test("provides a labeled coherent path, water, and shoreline transition kit", async () => {
  const source = await readFile("scratchpad/2d-slice-art-source/nirvana-tiles-source.png");
  const strict = await repairProductionTiles(source);
  const atlas = await packTileAtlas(strict, { columns: 8, rows: 8, cellWidth: 128, cellHeight: 128 });
  assert.equal(TILE_INVENTORY.length, 64);
  for (const required of ["path-horizontal", "path-corner-ne", "water-horizontal", "water-corner-ne", "shore-horizontal", "shore-corner-ne"]) assert.ok(TILE_INVENTORY.includes(required));
  assert.deepEqual((await validateTransitionSeams(atlas)).issues, []);
  const { data } = await sharp(atlas).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const colors = new Set();
  for (let index = 0; index < data.length; index += 4) if (data[index + 3] > 8) colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
  assert.ok(colors.size >= 15, `reviewed source palette should retain all 15 authored colors, found ${colors.size}`);
  assert.ok(atlas.length >= 8_000, `organic tile atlas should not collapse to placeholder geometry (${atlas.length} bytes)`);
  const art = await validateTileArt(atlas);
  assert.deepEqual(art.issues, []);
  for (const cell of art.representativeCells) assert.ok(cell.colors >= 3 && cell.distinctRowSpans >= 3 && cell.distinctColumnSpans >= 3);
  const proof = await composeTerrainProof(atlas);
  assert.deepEqual([(await sharp(proof).metadata()).width, (await sharp(proof).metadata()).height], [320, 192]);
});

test("reports stable feet anchors within two logical pixels", async () => {
  const frame = await sharp({
    create: { width: 48, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: await png(12, 8, "#553c2c"), left: 18, top: 54 }]).png().toBuffer();
  const atlas = await sharp({
    create: { width: 144, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([
    { input: frame, left: 0, top: 0 },
    { input: frame, left: 48, top: 1 },
    { input: frame, left: 96, top: 0 },
  ]).png().toBuffer();
  const result = await validateOccupancy(atlas, { cellWidth: 48, cellHeight: 64, columns: 3, rows: 1 });
  assert.equal(result.alphaBleed, false);
  assert.ok(result.maxFeetDrift <= 2);
});

test("reports cell gutter overflow and unexpected occupied cells", async () => {
  const atlas = await sharp({ create: { width: 96, height: 64, channels: 4, background: transparent } })
    .composite([{ input: await png(4, 4, "#553c2c"), left: 0, top: 20 }, { input: await png(4, 4, "#553c2c"), left: 60, top: 20 }]).png().toBuffer();
  const result = await validateOccupancy(atlas, { cellWidth: 48, cellHeight: 64, columns: 2, rows: 1, gutter: 1, expectedEmpty: [1] });
  assert.equal(result.cellOverflow, true);
  assert.deepEqual(result.overflowFrames, [0]);
  assert.deepEqual(result.unexpectedOccupied, [1]);
});

test("writes labeled native, exact 2x, and 390x844 mobile panels", async () => {
  const atlas = await png(48, 64, { r: 79, g: 104, b: 63, alpha: 1 });
  const sheet = await writeContactSheet([{ label: "body", buffer: atlas, columns: 1, rows: 1 }]);
  assert.deepEqual(sheet.panels, ["Native 1x", "Exact 2x", "Mobile 390x844"]);
  assert.deepEqual(sheet.mobileInventory, { body: 1 });
  const metadata = await sharp(sheet.buffer).metadata();
  assert.ok(metadata.width >= 390);
  assert.ok(metadata.height >= 844);
  const pixels = await sharp(sheet.buffer).ensureAlpha().raw().toBuffer();
  const width = metadata.width;
  const rgbaAt = (x, y) => [...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
  assert.deepEqual(rgbaAt(720, 76), [79, 104, 63, 255]);
  assert.deepEqual(rgbaAt(721, 76), rgbaAt(720, 76));
  assert.deepEqual(rgbaAt(720, 77), rgbaAt(720, 76));
  assert.deepEqual(rgbaAt(2130, 100), [79, 104, 63, 255]);
});

test("persists a complete machine-readable validation report for every runtime atlas", async () => {
  const report = JSON.parse(await readFile("scratchpad/2d-slice-art-source/runtime-validation-report.json", "utf8"));
  assert.equal(report.passed, true);
  assert.deepEqual(Object.keys(report.atlases).sort(), [
    "human-body-atlas.png", "human-face-atlas.png", "human-held-atlas.png", "nirvana-tile-atlas.png", "shelter-slice-atlas.png",
  ]);
  for (const atlas of Object.values(report.atlases)) {
    assert.ok(atlas.width > 0 && atlas.height > 0);
    assert.ok(atlas.compressedBytes > 0 && atlas.decodedBytes === atlas.width * atlas.height * 4);
    assert.equal(atlas.chromaResidue, 0);
    assert.equal(atlas.alphaBleed, false);
    assert.equal(atlas.cellOverflow, false);
    assert.deepEqual(atlas.unexpectedOccupied, []);
    assert.deepEqual(atlas.unexpectedEmpty, []);
    assert.ok(Array.isArray(atlas.anchors));
  }
  assert.equal(report.tileInventory.length, 64);
  assert.deepEqual(report.transitionSeams.issues, []);
  assert.deepEqual(report.overlayAlignment.issues, []);
  assert.deepEqual(report.directionalBody.issues, []);
  assert.deepEqual(report.directionalFace.issues, []);
  assert.equal(report.directionalFace.northOpaquePixels, 0);
  assert.equal(report.directionalFace.mirroredProfiles, true);
  assert.match(report.sourceProvenance.face.method, /direction-aware native facial-feature authoring/);
  assert.deepEqual(report.directionalBody.detachedUpperComponents, []);
  assert.deepEqual(report.directionalBody.frameCounts, { idle: 4, walk: 6, turn: 2, stop: 2 });
  assert.equal(report.directionalBody.distinctFramesPerDirection, 14);
  assert.ok(report.directionalBody.maxFeetDrift <= 2);
  assert.ok(report.directionalBody.maxIdleHeightDrift <= 2);
  assert.deepEqual(report.contactSheet.mobileInventory, {
    "tiles-labeled-in-report": 64, "human-body-all-frames": 112, "human-face-all-frames": 32,
    "human-held-all-frames": 8, "shelter-all-components": 20, "all-held-composite-proofs": 6,
    "directional-face-composite-proofs": 12, "terrain-prop-style-proof": 60,
  });
});
