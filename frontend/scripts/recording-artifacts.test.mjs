import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalJson,
  readNormalizedJson,
  sha256Buffer,
  validateMarkerDocument,
  validateRecordingFrameLedger,
} from "./recording-artifacts.mjs";

test("canonicalJson sorts every object level and rejects non-finite data", () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, b: 3 } }), '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "z": 1\n}\n');
  assert.throws(() => canonicalJson({ value: Number.NaN }), /finite JSON number/);
  assert.throws(() => canonicalJson({ value: undefined }), /undefined/);
});

test("readNormalizedJson rejects semantically valid but non-normalized JSON", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vivarium-normalized-"));
  try {
    const file = path.join(root, "evidence.json");
    await writeFile(file, '{"z":1,"a":2}\n');
    await assert.rejects(readNormalizedJson(file), /not normalized/);
    await writeFile(file, canonicalJson({ z: 1, a: 2 }));
    assert.deepEqual(await readNormalizedJson(file), { a: 2, z: 1 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("marker validation binds unique named stills to exact 30 fps frames and bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vivarium-markers-"));
  try {
    const still = Buffer.from("exact-marker-frame");
    await mkdir(path.join(root, "markers"));
    await writeFile(path.join(root, "markers", "contact.png"), still);
    const document = {
      schemaVersion: 1,
      chronicleId: "C03",
      viewport: "desktop",
      expected: ["event:resource_changed"],
      observed: [{
        id: "C03:1:consequence",
        label: "Resource gathered",
        expectedMarker: "event:resource_changed",
        frameIndex: 3,
        mediaTimeMs: 100,
        presentationTimeMs: 100,
        still: { file: "markers/contact.png", bytes: still.length, sha256: sha256Buffer(still) },
      }],
    };
    await validateMarkerDocument(document, { directory: root, frameCount: 6, fps: 30 });
    await assert.rejects(
      validateMarkerDocument({ ...document, observed: [...document.observed, document.observed[0]] }, { directory: root, frameCount: 6, fps: 30 }),
      /duplicate marker id/,
    );
    await assert.rejects(
      validateMarkerDocument({ ...document, observed: [{ ...document.observed[0], mediaTimeMs: 101 }] }, { directory: root, frameCount: 6, fps: 30 }),
      /exact frame timestamp/,
    );
    await writeFile(path.join(root, "outside.png"), still);
    await assert.rejects(
      validateMarkerDocument({ ...document, observed: [{ ...document.observed[0], still: { ...document.observed[0].still, file: "outside.png" } }] }, { directory: root, frameCount: 6, fps: 30 }),
      /markers.*\.png/,
    );
    await writeFile(path.join(root, "markers", "contact.png"), Buffer.from("changed"));
    await assert.rejects(validateMarkerDocument(document, { directory: root, frameCount: 6, fps: 30 }), /still.*(?:byte size|hash)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recording frame validation requires complete retained accepted-frame lineage", () => {
  const identity = {
    runId: "run-1",
    sourceKey: "live:run-1",
    firstCursor: 0,
    lastCursor: 4,
    revision: 2,
  };
  const frames = [0, 1, 2].map((frameIndex) => ({
    frameIndex,
    mediaTimeMs: frameIndex * 1000 / 30,
    presentationTimeMs: frameIndex * 1000 / 30,
    bytes: 0,
    sha256: "0".repeat(64),
    presentedCursor: 4,
    exactBaseCursor: 4,
    projectedThroughCursor: 4,
    region: {
      activeRegionId: "meadow",
      visibleRegionId: "meadow",
      loadingRegionId: null,
    },
    canvasFrameIdentity: { ...identity },
    observerFrameIdentity: { ...identity },
  }));
  const document = {
    fps: 30,
    frameCount: frames.length,
    timelineSha256: sha256Buffer(Buffer.from(canonicalJson(frames))),
    frames,
  };
  assert.deepEqual(validateRecordingFrameLedger(document), frames);

  const narrationLag = structuredClone(document);
  narrationLag.frames[1].presentedCursor = 3;
  narrationLag.frames[1].exactBaseCursor = 3;
  narrationLag.frames[1].projectedThroughCursor = 4;
  narrationLag.timelineSha256 = sha256Buffer(Buffer.from(canonicalJson(narrationLag.frames)));
  assert.deepEqual(
    validateRecordingFrameLedger(narrationLag),
    narrationLag.frames,
    "accepted projected truth may lead the director cursor while a consequence is presented",
  );

  for (const [label, mutate] of [
    ["exact cursor beyond projected cursor", (frame) => { frame.exactBaseCursor = 5; }],
    ["exact cursor beyond presented cursor", (frame) => { frame.presentedCursor = 3; }],
    ["presented cursor beyond projected cursor", (frame) => {
      frame.exactBaseCursor = 3;
      frame.projectedThroughCursor = 3;
    }],
    ["projected cursor beyond accepted identity", (frame) => { frame.projectedThroughCursor = 5; }],
    ["presented cursor beyond accepted identity", (frame) => { frame.presentedCursor = 5; }],
  ]) {
    const malformed = structuredClone(document);
    mutate(malformed.frames[1]);
    malformed.timelineSha256 = sha256Buffer(Buffer.from(canonicalJson(malformed.frames)));
    assert.throws(
      () => validateRecordingFrameLedger(malformed),
      /frame 1 retained accepted-frame lineage cursors are inconsistent/,
      label,
    );
  }

  for (const field of [
    "presentedCursor", "exactBaseCursor", "projectedThroughCursor", "region",
  ]) {
    const malformed = structuredClone(document);
    delete malformed.frames[1][field];
    malformed.timelineSha256 = sha256Buffer(Buffer.from(canonicalJson(malformed.frames)));
    assert.throws(
      () => validateRecordingFrameLedger(malformed),
      new RegExp(`frame 1.*${field}|retained accepted-frame lineage`, "i"),
      field,
    );
  }
});
