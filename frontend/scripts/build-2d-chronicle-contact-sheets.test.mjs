import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { canonicalJson, sha256Buffer } from "./recording-artifacts.mjs";
import { buildChronicleContactSheet } from "./build-2d-chronicle-contact-sheets.mjs";
import { validateContactSheet } from "./record-2d-chronicles.mjs";

test("builds byte-identical contact sheets with real label pixels and stable marker order", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vivarium-sheet-"));
  try {
    const chronicle = path.join(root, "C03");
    const desktop = path.join(chronicle, "desktop");
    const mobile = path.join(chronicle, "mobile");
    await Promise.all([mkdir(path.join(desktop, "markers"), { recursive: true }), mkdir(path.join(mobile, "markers"), { recursive: true })]);
    await writeMarkerSet(desktop, "desktop", 120, 80, "#2a7050", "Resource <gathered> & stored");
    await writeMarkerSet(mobile, "mobile", 80, 120, "#70402a");
    const first = await buildChronicleContactSheet(chronicle);
    const firstBytes = await readFile(first.imagePath);
    const firstMetadata = JSON.parse(await readFile(first.sidecarPath, "utf8"));
    const second = await buildChronicleContactSheet(chronicle);
    assert.equal(sha256Buffer(await readFile(second.imagePath)), sha256Buffer(firstBytes));
    assert.deepEqual(firstMetadata.cells.map(({ viewport, markerId }) => [viewport, markerId]), [
      ["desktop", "C03:1:consequence"],
      ["mobile", "C03:1:consequence"],
    ]);
    const { data, info } = await sharp(firstBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const labelRows = data.subarray(0, info.width * 38 * 4);
    assert.ok(new Set(labelRows).size > 8, "label band must contain rendered label pixels");
    let brightLabelPixels = 0;
    for (let index = 0; index < labelRows.length; index += 4) {
      if (labelRows[index] > 220 && labelRows[index + 1] > 220 && labelRows[index + 2] > 190) brightLabelPixels += 1;
    }
    assert.ok(brightLabelPixels > 20, "label band must contain rasterized text, not metadata only");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects blank labels and stale still hashes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vivarium-sheet-invalid-"));
  try {
    const chronicle = path.join(root, "C03");
    const desktop = path.join(chronicle, "desktop");
    const mobile = path.join(chronicle, "mobile");
    await Promise.all([mkdir(path.join(desktop, "markers"), { recursive: true }), mkdir(path.join(mobile, "markers"), { recursive: true })]);
    await writeMarkerSet(desktop, "desktop", 120, 80, "#2a7050", "");
    await writeMarkerSet(mobile, "mobile", 80, 120, "#70402a");
    await assert.rejects(buildChronicleContactSheet(chronicle), /blank marker label/);
    await writeMarkerSet(desktop, "desktop", 120, 80, "#2a7050");
    const document = JSON.parse(await readFile(path.join(desktop, "markers.json"), "utf8"));
    document.observed[0].still.sha256 = "0".repeat(64);
    await writeFile(path.join(desktop, "markers.json"), canonicalJson(document));
    await assert.rejects(buildChronicleContactSheet(chronicle), /still.*hash/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects omitted, duplicated, relabeled, and wrong-marker contact-sheet cells", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vivarium-sheet-cross-links-"));
  try {
    const chronicle = path.join(root, "C03");
    const desktop = path.join(chronicle, "desktop");
    const mobile = path.join(chronicle, "mobile");
    await Promise.all([
      mkdir(path.join(desktop, "markers"), { recursive: true }),
      mkdir(path.join(mobile, "markers"), { recursive: true }),
    ]);
    await writeMarkerSet(desktop, "desktop", 120, 80, "#2a7050");
    await writeMarkerSet(mobile, "mobile", 80, 120, "#70402a");
    const { sidecarPath } = await buildChronicleContactSheet(chronicle);
    const original = JSON.parse(await readFile(sidecarPath, "utf8"));
    const mutations = [
      (document) => document.cells.pop(),
      (document) => document.cells.push(structuredClone(document.cells[0])),
      (document) => { document.cells[0].label = "C03 · DESKTOP · Wrong label"; },
      (document) => { document.cells[0].markerId = "C03:999:wrong"; },
    ];
    for (const mutate of mutations) {
      const document = structuredClone(original);
      mutate(document);
      await writeFile(sidecarPath, canonicalJson(document));
      await assert.rejects(
        validateContactSheet(chronicle, "C03"),
        /contact sheet marker cell cross-link drift/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeMarkerSet(directory, viewport, width, height, color, label = "Resource gathered") {
  const relative = "markers/000003-resource-gathered.png";
  const buffer = await sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
  await writeFile(path.join(directory, relative), buffer);
  await writeFile(path.join(directory, "markers.json"), canonicalJson({
    schemaVersion: 1,
    chronicleId: "C03",
    viewport,
    expected: ["event:resource_changed"],
    observed: [{
      id: "C03:1:consequence",
      label,
      expectedMarker: "event:resource_changed",
      frameIndex: 3,
      mediaTimeMs: 100,
      presentationTimeMs: 100,
      still: { file: relative, bytes: buffer.length, sha256: sha256Buffer(buffer) },
    }],
  }));
}
