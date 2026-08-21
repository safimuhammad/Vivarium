/** Integration contract for final-pixel R5 reauthor provenance and trust. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  REGIONAL_R5_AUTHORING_SOURCES,
} from "./regional-art-r5-authoring-spec.mjs";
import * as productionPacker from "./pack-2d-production-assets.mjs";

const CELL_GEOMETRY = Object.freeze({
  terrain: Object.freeze({ width: 32, height: 32 }),
  scenery: Object.freeze({ width: 32, height: 32 }),
  landmarks: Object.freeze({ width: 128, height: 128 }),
});
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function atlasCell(raw, index, width, height) {
  const columns = raw.width / width;
  const left = (index % columns) * width;
  const top = Math.floor(index / columns) * height;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    raw.data.copy(
      data,
      y * width * 4,
      ((top + y) * raw.width + left) * 4,
      ((top + y) * raw.width + left + width) * 4,
    );
  }
  return data;
}

function compositeLayers(layers, byteLength) {
  const data = Buffer.alloc(byteLength);
  for (const { raw } of layers) for (let offset = 0; offset < byteLength; offset += 4) {
    if (raw.data[offset + 3] === 0) continue;
    raw.data.copy(data, offset, offset, offset + 4);
  }
  return data;
}

let authoringPromise;
async function exactAuthoring() {
  authoringPromise ??= productionPacker.buildRegionalR5SourceMasters({
    sourceBuffers: {
      regionKits: await readFile(REGIONAL_R5_AUTHORING_SOURCES.regionKits.path),
      homeRuin: await readFile(REGIONAL_R5_AUTHORING_SOURCES.homeRuin.path),
    },
  });
  return authoringPromise;
}

test("R5 reauthor binds every rewritten cell layer to exact final master RGBA", async () => {
  const authoring = await exactAuthoring();
  const targets = productionPacker.regionalR5ReauthorTargets();
  const expectedTargetCount = Object.values(targets).reduce((total, families) => (
    total + families.terrain.length + families.scenery.length + families.landmarks.length
  ), 0);
  assert.equal(authoring.reauthorReceipt?.schema, "regional-r5-atlas-reauthor-integration/v1");
  assert.equal(authoring.reauthorReceipt?.targetCellCount, expectedTargetCount);
  assert.equal(authoring.reauthorReceipt?.cells?.length, expectedTargetCount);
  assert.match(authoring.reauthorReceipt?.canonicalSha256 ?? "", /^[a-f0-9]{64}$/u);

  const receiptCells = new Map(authoring.reauthorReceipt.cells.map((entry) => [
    `${entry.atlasId}:${entry.cell}`,
    entry,
  ]));
  assert.equal(receiptCells.size, expectedTargetCount, "per-cell receipt keys must be unique");
  for (const [kit, families] of Object.entries(targets)) for (const [family, cells] of Object.entries(families)) {
    const atlasId = `${kit}-${family}`;
    const geometry = CELL_GEOMETRY[family];
    for (const cell of cells) {
      const key = `${atlasId}:${cell}`;
      const finalCell = atlasCell(
        authoring.rawMasters[atlasId],
        cell,
        geometry.width,
        geometry.height,
      );
      const layers = authoring.cellLayersByAtlas.get(key);
      assert.ok(Array.isArray(layers) && layers.length > 0, `${key}: final source layers required`);
      assert.equal(
        compositeLayers(layers, finalCell.length).equals(finalCell),
        true,
        `${key}: downstream cell layers must equal final master RGBA`,
      );
      const receipt = receiptCells.get(key);
      assert.ok(receipt, `${key}: per-cell reauthor receipt required`);
      assert.equal(receipt.family, family);
      assert.equal(receipt.beforeRgbaSha256 === receipt.afterRgbaSha256, false,
        `${key}: target must record a real pixel replacement`);
      assert.equal(receipt.afterRgbaSha256, sha256(finalCell), `${key}: final receipt hash drift`);
    }
  }
});

test("R5 reauthor versions all overwritten blind repairs in its immutable receipt", async () => {
  const authoring = await exactAuthoring();
  assert.equal(Object.isFrozen(authoring.reauthorReceipt), true);
  assert.equal(Object.isFrozen(authoring.reauthorReceipt.changedAtlasIds), true);
  assert.equal(Object.isFrozen(authoring.reauthorReceipt.cells), true);
  assert.equal(authoring.reauthorReceipt.cells.every(Object.isFrozen), true);
  assert.deepEqual(
    authoring.reauthorReceipt.cells
      .filter(({ supersededBlindRepairId }) => supersededBlindRepairId !== null)
      .map(({ supersededBlindRepairId }) => supersededBlindRepairId)
      .sort(),
    [
      "task5-blind-repair/neutral-paired-trees",
      "task5-blind-repair/spring-broken-sight-reed-gap",
      "task5-blind-repair/spring-north-south-timber-planks",
      "task5-blind-repair/spring-two-wet-stone-levels",
    ],
  );
});

test("R5 trusted authoring rejects receipt replacement and final-layer byte tampering", async () => {
  const authoring = await productionPacker.buildRegionalR5SourceMasters({
    sourceBuffers: {
      regionKits: await readFile(REGIONAL_R5_AUTHORING_SOURCES.regionKits.path),
      homeRuin: await readFile(REGIONAL_R5_AUTHORING_SOURCES.homeRuin.path),
    },
  });
  const build = () => productionPacker.buildRegionalR5KeyScene({
    kit: "worn-heartland",
    authoring,
  });
  const receipt = authoring.reauthorReceipt;
  authoring.reauthorReceipt = { ...receipt, targetCellCount: 0 };
  await assert.rejects(build(), /trusted source-master authoring provenance and identity/iu);
  authoring.reauthorReceipt = receipt;

  const layer = authoring.cellLayersByAtlas.get("worn-heartland-terrain:8")[0];
  layer.raw.data[0] ^= 0xff;
  await assert.rejects(build(), /trusted source-master authoring provenance and identity/iu);
  layer.raw.data[0] ^= 0xff;
});
