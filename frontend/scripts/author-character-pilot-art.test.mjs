import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import sharp from "sharp";

import { authorCharacterPilotArt } from "./author-character-pilot-art.mjs";

const FRAME_WIDTH = 48;
const FRAME_HEIGHT = 64;
const COLUMNS = 16;
const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const CANONICAL_ANCHOR_SOURCE = path.resolve(
  MODULE_ROOT,
  "../src/assets/renderer2d/core/production-core-source.json",
);
const CANONICAL_ANCHOR_SOURCE_PATH = "src/assets/renderer2d/core/production-core-source.json";
const DIRECTIONAL_FACE_ANCHORS = {
  south: [24, 18],
  east: [26, 19],
  north: [24, 18],
  west: [22, 18],
};
const OVERLAY_HELD_ANCHOR = [34, 38];
const FACINGS = ["south", "east", "north", "west"];
const ACTION_FRAME_COUNTS = new Map([
  ["idle", 4],
  ["walk", 6],
  ["run", 8],
  ["turn", 2],
  ["stop", 2],
  ["reach-give", 6],
  ["work", 6],
  ["hurt-fall", 6],
  ["prone", 2],
  ["dead", 1],
]);
const EXPRESSIONS = [
  "neutral",
  "blink-1",
  "blink-2",
  "talk-1",
  "talk-2",
  "weary",
  "hurt",
  "recovery",
];
const EXPECTED_ATLASES = new Map([
  ["core-human-body-rigs", {
    file: "character-pilot-body.png",
    width: 768,
    height: 704,
  }],
  ["core-human-face-planes", {
    file: "character-pilot-face.png",
    width: 768,
    height: 256,
  }],
  ["core-human-hair", {
    file: "character-pilot-hair.png",
    width: 768,
    height: 768,
  }],
  ["core-human-clothing-00", {
    file: "character-pilot-clothing.png",
    width: 768,
    height: 704,
  }],
  ["core-human-held", {
    file: "character-pilot-held.png",
    width: 768,
    height: 256,
  }],
  ["core-human-status-effects", {
    file: "character-pilot-status.png",
    width: 512,
    height: 256,
    cellWidth: 32,
    cellHeight: 32,
  }],
]);
const BODY_OUTLINE = [0x28, 0x1d, 0x18, 0xff];
const FOOTWEAR_FILL = [0x65, 0x43, 0x2c, 0xff];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function bodyActionOffset(action) {
  let offset = 0;
  for (const [candidate, count] of ACTION_FRAME_COUNTS) {
    if (candidate === action) return offset;
    offset += count;
  }
  throw new Error(`Unknown body action ${action}`);
}

function bodyCell(facing, action, frame) {
  return FACINGS.indexOf(facing) * 43 + bodyActionOffset(action) + frame;
}

function faceCell(facing, expression) {
  return FACINGS.indexOf(facing) * 16 + EXPRESSIONS.indexOf(expression);
}

function cellOffset(raw, cellIndex, x, y, cellWidth = FRAME_WIDTH, cellHeight = FRAME_HEIGHT) {
  const columns = raw.info.width / cellWidth;
  const left = (cellIndex % columns) * cellWidth;
  const top = Math.floor(cellIndex / columns) * cellHeight;
  return ((top + y) * raw.info.width + left + x) * 4;
}

function rgbaAt(raw, cellIndex, x, y, cellWidth = FRAME_WIDTH, cellHeight = FRAME_HEIGHT) {
  const offset = cellOffset(raw, cellIndex, x, y, cellWidth, cellHeight);
  return [
    raw.data[offset],
    raw.data[offset + 1],
    raw.data[offset + 2],
    raw.data[offset + 3],
  ];
}

function alphaBounds(raw, cellIndex, cellWidth = FRAME_WIDTH, cellHeight = FRAME_HEIGHT) {
  let minX = cellWidth;
  let minY = cellHeight;
  let maxX = -1;
  let maxY = -1;
  let pixels = 0;
  for (let y = 0; y < cellHeight; y += 1) {
    for (let x = 0; x < cellWidth; x += 1) {
      if (rgbaAt(raw, cellIndex, x, y, cellWidth, cellHeight)[3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      pixels += 1;
    }
  }
  return pixels === 0 ? null : { minX, minY, maxX, maxY, pixels };
}

function cellBytes(raw, cellIndex, cellWidth = FRAME_WIDTH, cellHeight = FRAME_HEIGHT) {
  const bytes = Buffer.alloc(cellWidth * cellHeight * 4);
  let cursor = 0;
  for (let y = 0; y < cellHeight; y += 1) {
    for (let x = 0; x < cellWidth; x += 1) {
      const source = cellOffset(raw, cellIndex, x, y, cellWidth, cellHeight);
      raw.data.copy(bytes, cursor, source, source + 4);
      cursor += 4;
    }
  }
  return bytes;
}

function countOpaqueComponents(raw, cellIndex, region) {
  const points = new Set();
  for (let y = region.top; y < region.bottom; y += 1) {
    for (let x = region.left; x < region.right; x += 1) {
      if (rgbaAt(raw, cellIndex, x, y)[3] > 0) points.add(`${x},${y}`);
    }
  }
  let components = 0;
  while (points.size > 0) {
    components += 1;
    const [seed] = points;
    const queue = [seed];
    points.delete(seed);
    while (queue.length > 0) {
      const current = queue.pop();
      const [x, y] = current.split(",").map(Number);
      for (const candidate of [
        `${x - 1},${y}`,
        `${x + 1},${y}`,
        `${x},${y - 1}`,
        `${x},${y + 1}`,
      ]) {
        if (!points.delete(candidate)) continue;
        queue.push(candidate);
      }
    }
  }
  return components;
}

function countOpaquePixels(raw, cellIndex, region) {
  let pixels = 0;
  for (let y = region.top; y < region.bottom; y += 1) {
    for (let x = region.left; x < region.right; x += 1) {
      if (rgbaAt(raw, cellIndex, x, y)[3] > 0) pixels += 1;
    }
  }
  return pixels;
}

function matchingPixels(raw, cellIndex, region, color = null) {
  const points = [];
  for (let y = region.top; y < region.bottom; y += 1) {
    for (let x = region.left; x < region.right; x += 1) {
      const candidate = rgbaAt(raw, cellIndex, x, y);
      if (candidate[3] === 0) continue;
      if (color && !candidate.every((channel, index) => channel === color[index])) continue;
      points.push({ x, y });
    }
  }
  return points;
}

function connectedPixelBounds(points) {
  const remaining = new Map(points.map((point) => [`${point.x},${point.y}`, point]));
  const components = [];
  while (remaining.size > 0) {
    const [seedKey, seed] = remaining.entries().next().value;
    remaining.delete(seedKey);
    const queue = [seed];
    const component = [];
    while (queue.length > 0) {
      const point = queue.pop();
      component.push(point);
      for (const candidateKey of [
        `${point.x - 1},${point.y}`,
        `${point.x + 1},${point.y}`,
        `${point.x},${point.y - 1}`,
        `${point.x},${point.y + 1}`,
      ]) {
        const candidate = remaining.get(candidateKey);
        if (!candidate) continue;
        remaining.delete(candidateKey);
        queue.push(candidate);
      }
    }
    components.push({
      minX: Math.min(...component.map(({ x }) => x)),
      minY: Math.min(...component.map(({ y }) => y)),
      maxX: Math.max(...component.map(({ x }) => x)),
      maxY: Math.max(...component.map(({ y }) => y)),
      pixels: component.length,
    });
  }
  return components.sort((left, right) => left.minX - right.minX);
}

function footwearBounds(raw, cellIndex, feetY) {
  return connectedPixelBounds(
    matchingPixels(
      raw,
      cellIndex,
      {
        left: 0,
        top: Math.max(0, feetY - 8),
        right: FRAME_WIDTH,
        bottom: FRAME_HEIGHT,
      },
      FOOTWEAR_FILL,
    ),
  );
}

function coordinates(points) {
  return points.map(({ x, y }) => [x, y]);
}

async function readRaw(file) {
  return sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

test("authors a deterministic immutable pilot atlas contract and publishes metadata last", async (context) => {
  const firstRoot = await mkdtemp(path.join(tmpdir(), "vivarium-character-pilot-a-"));
  const secondRoot = await mkdtemp(path.join(tmpdir(), "vivarium-character-pilot-b-"));
  context.after(async () => {
    await Promise.all([
      rm(firstRoot, { recursive: true, force: true }),
      rm(secondRoot, { recursive: true, force: true }),
    ]);
  });

  const first = await authorCharacterPilotArt(firstRoot);
  const second = await authorCharacterPilotArt(secondRoot);
  assert.equal(first, path.join(firstRoot, "character-pilot-assets.json"));
  assert.equal(second, path.join(secondRoot, "character-pilot-assets.json"));

  const firstMetadataBytes = await readFile(first);
  const secondMetadataBytes = await readFile(second);
  assert.deepEqual(firstMetadataBytes, secondMetadataBytes);
  const metadata = JSON.parse(firstMetadataBytes.toString("utf8"));
  const canonicalBytes = await readFile(CANONICAL_ANCHOR_SOURCE);
  const canonical = JSON.parse(canonicalBytes.toString("utf8"));
  assert.deepEqual(metadata.frame, { width: 48, height: 64 });
  assert.deepEqual(metadata.feet, { x: 24, y: 61 });
  assert.equal(metadata.version, 1);
  assert.equal(metadata.walkStride, 12);
  assert.deepEqual(metadata.selection, {
    rig: "human-a",
    hairSilhouette: "messy",
    clothingSilhouette: "work-shirt-sash",
    resourceHeldForm: "resource-handful",
    workHeldForm: "hammer",
  });
  assert.deepEqual(
    metadata.topology.actions,
    Object.fromEntries(ACTION_FRAME_COUNTS),
  );
  assert.deepEqual(metadata.topology.facings, FACINGS);
  assert.deepEqual(metadata.topology.expressions, EXPRESSIONS);
  assert.equal(metadata.bodyFrameAnchors.length, 172);
  assert.deepEqual(
    metadata.bodyFrameAnchors,
    canonical.bodyFrameAnchors.slice(0, 172),
    "pilot anchors must be the canonical human-a attachment table",
  );
  assert.deepEqual(metadata.anchorSource, {
    path: CANONICAL_ANCHOR_SOURCE_PATH,
    sha256: sha256(canonicalBytes),
  });

  assert.equal(metadata.atlases.length, EXPECTED_ATLASES.size);
  for (const descriptor of metadata.atlases) {
    const expected = EXPECTED_ATLASES.get(descriptor.id);
    assert.ok(expected, `unexpected atlas ${descriptor.id}`);
    assert.deepEqual(descriptor, {
      id: descriptor.id,
      file: expected.file,
      width: expected.width,
      height: expected.height,
      cellWidth: expected.cellWidth ?? FRAME_WIDTH,
      cellHeight: expected.cellHeight ?? FRAME_HEIGHT,
      sha256: descriptor.sha256,
    });
    assert.match(descriptor.sha256, /^[a-f0-9]{64}$/);
    const firstBytes = await readFile(path.join(firstRoot, descriptor.file));
    const secondBytes = await readFile(path.join(secondRoot, descriptor.file));
    assert.equal(sha256(firstBytes), descriptor.sha256);
    assert.deepEqual(firstBytes, secondBytes);
    const image = await sharp(firstBytes).metadata();
    assert.equal(image.width, descriptor.width);
    assert.equal(image.height, descriptor.height);
  }

  const evidence = new Map([
    ["character-pilot-front-idle-evidence.png", { width: 384, height: 512 }],
    ["character-pilot-east-mid-walk-evidence.png", { width: 384, height: 512 }],
  ]);
  for (const [file, expected] of evidence) {
    const image = await sharp(path.join(firstRoot, file)).metadata();
    assert.equal(image.width, expected.width);
    assert.equal(image.height, expected.height);
  }
  const publishedFiles = await readdir(firstRoot);
  assert.equal(
    publishedFiles.filter((file) => file.includes(".tmp-")).length,
    0,
    "temporary siblings must not survive a successful atomic publication",
  );
  assert.deepEqual(
    publishedFiles.sort(),
    [
      "character-pilot-assets.json",
      ...[...EXPECTED_ATLASES.values()].map(({ file }) => file),
      ...evidence.keys(),
    ].sort(),
  );
});

test("preserves prior metadata when a later payload cannot publish", async (context) => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "vivarium-character-pilot-failure-"));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const metadataPath = await authorCharacterPilotArt(outputRoot);
  const sentinel = Buffer.from('{"sentinel":"prior-metadata"}\n', "utf8");
  await writeFile(metadataPath, sentinel);

  const blockedPayload = path.join(
    outputRoot,
    "character-pilot-east-mid-walk-evidence.png",
  );
  await rm(blockedPayload, { force: true });
  await mkdir(blockedPayload);

  await assert.rejects(
    authorCharacterPilotArt(outputRoot),
    /rename/,
    "controlled mid-publication failure must reject before metadata publication",
  );
  assert.deepEqual(
    await readFile(metadataPath),
    sentinel,
    "metadata must remain untouched until every payload has published",
  );
  assert.equal(
    (await readdir(outputRoot)).filter((file) => file.includes(".tmp-")).length,
    0,
    "failed atomic payloads must clean their temporary sibling",
  );
});

test("authors centered south anatomy and restrained mouth silhouettes", async (context) => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "vivarium-character-pilot-anatomy-"));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  await authorCharacterPilotArt(outputRoot);

  const body = await readRaw(path.join(outputRoot, "character-pilot-body.png"));
  const clothing = await readRaw(path.join(outputRoot, "character-pilot-clothing.png"));
  const face = await readRaw(path.join(outputRoot, "character-pilot-face.png"));
  const metadata = JSON.parse(
    await readFile(path.join(outputRoot, "character-pilot-assets.json"), "utf8"),
  );

  await context.test("centers two level south feet on every planted pose", () => {
    for (const [layerName, layer] of [["body", body], ["clothing", clothing]]) {
      for (const action of ["idle", "reach-give", "work"]) {
        const count = ACTION_FRAME_COUNTS.get(action);
        for (let frame = 0; frame < count; frame += 1) {
          const index = bodyCell("south", action, frame);
          const [feetX, feetY] = metadata.bodyFrameAnchors[index];
          const shoes = footwearBounds(layer, index, feetY);
          assert.equal(
            shoes.length,
            2,
            `${layerName} ${action}/${frame} must have two separated footwear envelopes`,
          );
          const [left, right] = shoes;
          assert.ok(
            left.maxX < feetX && right.minX > feetX,
            `${layerName} ${action}/${frame} must place one foot on each side of ${feetX}`,
          );
          assert.ok(
            Math.abs(((left.minX + right.maxX) / 2) - feetX) <= 1,
            `${layerName} ${action}/${frame} footwear midpoint must remain at ${feetX}`,
          );
          assert.ok(
            Math.abs(left.maxY - right.maxY) <= 1,
            `${layerName} ${action}/${frame} soles must share a baseline`,
          );
        }
      }
    }
  });

  await context.test("alternates both south walk legs around the canonical root", () => {
    const solesFor = (phase) => {
      const index = bodyCell("south", "walk", phase);
      const [feetX, feetY] = metadata.bodyFrameAnchors[index];
      const shoes = footwearBounds(body, index, feetY);
      assert.equal(shoes.length, 2, `south walk/${phase} must retain two feet`);
      const [left, right] = shoes;
      assert.ok(
        left.minX < feetX && right.maxX > feetX,
        `south walk/${phase} must straddle its canonical root`,
      );
      return {
        left: left.maxY - feetY,
        right: right.maxY - feetY,
      };
    };
    const legAForward = solesFor(0);
    const legBForward = solesFor(3);
    assert.ok(
      legAForward.left < legBForward.left,
      "travel.legA must advance the left foot between paired walk extremes",
    );
    assert.ok(
      legAForward.right > legBForward.right,
      "travel.legB must advance the right foot between paired walk extremes",
    );
  });

  await context.test("masks the south neck outline behind the face", () => {
    for (const action of ["idle", "reach-give", "work"]) {
      const count = ACTION_FRAME_COUNTS.get(action);
      for (let frame = 0; frame < count; frame += 1) {
        const index = bodyCell("south", action, frame);
        const [, , faceX, faceY] = metadata.bodyFrameAnchors[index];
        assert.equal(
          matchingPixels(
            body,
            index,
            {
              left: faceX - 3,
              top: faceY + 6,
              right: faceX + 4,
              bottom: faceY + 9,
            },
            BODY_OUTLINE,
          ).length,
          0,
          `south ${action}/${frame} face band must contain no neck outline`,
        );
      }
    }
  });

  await context.test("uses centered neutral mouths and rounded talk openings", () => {
    const mouthRegion = {
      left: 21,
      top: 22,
      right: 28,
      bottom: 27,
    };
    for (const expression of ["neutral", "blink-1", "blink-2", "recovery"]) {
      const cell = faceCell("south", expression);
      assert.deepEqual(
        coordinates(matchingPixels(face, cell, mouthRegion)),
        [[23, 24], [24, 24], [25, 24]],
        `south ${expression} must use exactly three centered mouth pixels`,
      );
      assert.equal(
        countOpaquePixels(face, cell, { left: 23, top: 22, right: 26, bottom: 24 }),
        0,
        `south ${expression} must keep a clear nose-to-mouth gap`,
      );
    }

    const talkContracts = [
      {
        expression: "talk-1",
        expected: [
          [24, 23],
          [23, 24], [24, 24], [25, 24],
          [24, 25],
        ],
        corners: [[23, 23], [25, 23], [23, 25], [25, 25]],
      },
      {
        expression: "talk-2",
        expected: [
          [23, 23], [24, 23], [25, 23],
          [22, 24], [23, 24], [24, 24], [25, 24], [26, 24],
          [23, 25], [24, 25], [25, 25],
        ],
        corners: [[22, 23], [26, 23], [22, 25], [26, 25]],
      },
    ];
    for (const { expression, expected, corners } of talkContracts) {
      const cell = faceCell("south", expression);
      for (const [x, y] of corners) {
        assert.equal(
          rgbaAt(face, cell, x, y)[3],
          0,
          `south ${expression} bounding-box corner ${x},${y} must be transparent`,
        );
      }
      assert.deepEqual(
        coordinates(matchingPixels(face, cell, mouthRegion)),
        expected,
        `south ${expression} must retain its rounded opening`,
      );
    }
  });
});

test("authors complete native topology with directional faces, rooted walk, and bounded hair", async (context) => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "vivarium-character-pilot-pixels-"));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  await authorCharacterPilotArt(outputRoot);

  const body = await readRaw(path.join(outputRoot, "character-pilot-body.png"));
  const clothing = await readRaw(path.join(outputRoot, "character-pilot-clothing.png"));
  const face = await readRaw(path.join(outputRoot, "character-pilot-face.png"));
  const hair = await readRaw(path.join(outputRoot, "character-pilot-hair.png"));
  const held = await readRaw(path.join(outputRoot, "character-pilot-held.png"));
  const status = await readRaw(path.join(outputRoot, "character-pilot-status.png"));
  const metadata = JSON.parse(
    await readFile(path.join(outputRoot, "character-pilot-assets.json"), "utf8"),
  );

  for (const facing of FACINGS) {
    for (const [action, count] of ACTION_FRAME_COUNTS) {
      for (let frame = 0; frame < count; frame += 1) {
        const index = bodyCell(facing, action, frame);
        const [feetX, feetY, faceX, faceY, heldX, heldY] = metadata.bodyFrameAnchors[index];
        assert.ok(alphaBounds(body, index)?.pixels > 100, `missing body ${facing}/${action}/${frame}`);
        assert.ok(alphaBounds(clothing, index)?.pixels > 100, `missing clothing ${facing}/${action}/${frame}`);
        assert.ok(
          rgbaAt(body, index, feetX, feetY)[3] > 0,
          `body root missed canonical feet ${facing}/${action}/${frame}`,
        );
        assert.ok(
          rgbaAt(clothing, index, feetX, feetY)[3] > 0,
          `clothing root missed canonical feet ${facing}/${action}/${frame}`,
        );
        assert.ok(
          rgbaAt(body, index, faceX, faceY)[3] > 0,
          `body face missed canonical anchor ${facing}/${action}/${frame}`,
        );
        assert.ok(
          rgbaAt(body, index, heldX, heldY)[3] > 0,
          `active hand missed canonical held anchor ${facing}/${action}/${frame}`,
        );
      }
    }
  }

  for (const facing of FACINGS) {
    for (const formIndex of [7, 14]) {
      const heldCell = FACINGS.indexOf(facing) * 16 + formIndex;
      assert.ok(
        rgbaAt(held, heldCell, ...OVERLAY_HELD_ANCHOR)[3] > 0,
        `${facing} held form ${formIndex} missed the overlay grip anchor`,
      );
    }
  }

  for (const facing of FACINGS) {
    const [overlayFaceX, overlayFaceY] = DIRECTIONAL_FACE_ANCHORS[facing];
    for (const [action, phase] of [
      ["reach-give", 3],
      ["work", 3],
      ["hurt-fall", 4],
      ["prone", 0],
      ["dead", 0],
    ]) {
      const index = bodyCell(facing, action, phase);
      const [, , bodyFaceX, bodyFaceY] = metadata.bodyFrameAnchors[index];
      const hairCell = 24 + FACINGS.indexOf(facing) * 6 + 5;
      let alignedHairPixels = 0;
      for (let y = 0; y < FRAME_HEIGHT; y += 1) {
        for (let x = 0; x < FRAME_WIDTH; x += 1) {
          if (rgbaAt(hair, hairCell, x, y)[3] === 0) continue;
          const bodyX = x + bodyFaceX - overlayFaceX;
          const bodyY = y + bodyFaceY - overlayFaceY;
          if (
            bodyX >= 0
            && bodyY >= 0
            && bodyX < FRAME_WIDTH
            && bodyY < FRAME_HEIGHT
            && rgbaAt(body, index, bodyX, bodyY)[3] > 0
          ) {
            alignedHairPixels += 1;
          }
        }
      }
      assert.ok(
        alignedHairPixels > 20,
        `${facing}/${action}/${phase} hair did not normalize through the body face anchor`,
      );
    }
  }

  for (const facing of FACINGS) {
    const normalized = (bounds, anchor) => ({
      minX: bounds.minX - anchor[0],
      minY: bounds.minY - anchor[1],
      maxX: bounds.maxX - anchor[0],
      maxY: bounds.maxY - anchor[1],
    });
    for (const [layerName, layer] of [["body", body], ["clothing", clothing]]) {
      for (let phase = 0; phase < 6; phase += 1) {
        const nextPhase = (phase + 1) % 6;
        const current = bodyCell(facing, "walk", phase);
        const next = bodyCell(facing, "walk", nextPhase);
        const currentAnchor = metadata.bodyFrameAnchors[current];
        const nextAnchor = metadata.bodyFrameAnchors[next];
        assert.notDeepEqual(
          cellBytes(layer, current),
          cellBytes(layer, next),
          `${facing} ${layerName} walk ${phase}->${nextPhase} must advance`,
        );
        assert.ok(
          rgbaAt(layer, current, currentAnchor[0], currentAnchor[1])[3] > 0,
          `${facing} ${layerName} walk ${phase} lost canonical contact`,
        );
        assert.ok(
          rgbaAt(layer, next, nextAnchor[0], nextAnchor[1])[3] > 0,
          `${facing} ${layerName} walk ${nextPhase} lost canonical contact`,
        );
        const currentNormalized = normalized(alphaBounds(layer, current), currentAnchor);
        const nextNormalized = normalized(alphaBounds(layer, next), nextAnchor);
        for (const edge of ["minX", "minY", "maxX", "maxY"]) {
          assert.ok(
            Math.abs(currentNormalized[edge] - nextNormalized[edge]) <= 5,
            `${facing} ${layerName} walk ${phase}->${nextPhase} ${edge} jumped after root normalization`,
          );
        }
      }
    }
  }

  for (const expression of EXPRESSIONS) {
    const south = faceCell("south", expression);
    assert.equal(
      countOpaqueComponents(face, south, { left: 17, top: 16, right: 31, bottom: 21 }),
      2,
      `south ${expression} must retain two separated eye components`,
    );
    assert.ok(
      alphaBounds(face, south) && [...Array(5).keys()].some((offset) => (
        [...Array(8).keys()].some((xOffset) => (
          rgbaAt(face, south, 20 + xOffset, 21 + offset)[3] > 0
        ))
      )),
      `south ${expression} must retain a visible mouth`,
    );

    const north = faceCell("north", expression);
    assert.equal(alphaBounds(face, north), null, `north ${expression} must contain no frontal features`);

    assert.ok(
      countOpaquePixels(face, south, { left: 21, top: 23, right: 29, bottom: 29 }) >= 2,
      `south ${expression} must retain mouth-only pixels below the nose`,
    );

    for (const facing of ["east", "west"]) {
      const profile = faceCell(facing, expression);
      const [anchorX, anchorY] = DIRECTIONAL_FACE_ANCHORS[facing];
      const eyeRegion = facing === "east"
        ? { left: anchorX + 1, top: anchorY - 3, right: anchorX + 6, bottom: anchorY + 2 }
        : { left: anchorX - 6, top: anchorY - 3, right: anchorX + 1, bottom: anchorY + 2 };
      assert.equal(
        countOpaqueComponents(face, profile, eyeRegion),
        1,
        `${facing} ${expression} must expose exactly one profile eye`,
      );
      const noseRegion = facing === "east"
        ? { left: anchorX + 6, top: anchorY, right: anchorX + 11, bottom: anchorY + 5 }
        : { left: anchorX - 11, top: anchorY, right: anchorX - 5, bottom: anchorY + 5 };
      const wrongNoseRegion = facing === "east"
        ? { left: anchorX - 11, top: anchorY, right: anchorX - 6, bottom: anchorY + 5 }
        : { left: anchorX + 6, top: anchorY, right: anchorX + 11, bottom: anchorY + 5 };
      assert.ok(
        countOpaquePixels(face, profile, noseRegion) >= 3,
        `${facing} ${expression} nose must project in the facing direction`,
      );
      assert.equal(
        countOpaquePixels(face, profile, wrongNoseRegion),
        0,
        `${facing} ${expression} must not grow a nose on the rear plane`,
      );
      const mouthRegion = facing === "east"
        ? { left: anchorX + 2, top: anchorY + 5, right: anchorX + 8, bottom: anchorY + 9 }
        : { left: anchorX - 8, top: anchorY + 5, right: anchorX - 1, bottom: anchorY + 9 };
      assert.ok(
        countOpaquePixels(face, profile, mouthRegion) >= 2,
        `${facing} ${expression} must retain a mouth below its nose`,
      );
    }
  }

  for (const facing of ["south", "east", "west"]) {
    const anchor = DIRECTIONAL_FACE_ANCHORS[facing];
    const eyeRegion = facing === "south"
      ? {
          left: anchor[0] - 6,
          top: anchor[1] - 2,
          right: anchor[0] + 7,
          bottom: anchor[1] + 3,
        }
      : facing === "east"
        ? {
            left: anchor[0] + 1,
            top: anchor[1] - 3,
            right: anchor[0] + 6,
            bottom: anchor[1] + 3,
          }
        : {
            left: anchor[0] - 6,
            top: anchor[1] - 3,
            right: anchor[0] + 1,
            bottom: anchor[1] + 3,
          };
    const neutral = faceCell(facing, "neutral");
    const halfClose = faceCell(facing, "blink-1");
    const fullClose = faceCell(facing, "blink-2");
    assert.notDeepEqual(
      cellBytes(face, halfClose),
      cellBytes(face, fullClose),
      `${facing} half-close and full-close blink frames must differ`,
    );
    assert.ok(
      countOpaquePixels(face, neutral, eyeRegion)
        > countOpaquePixels(face, halfClose, eyeRegion),
      `${facing} neutral eyes must be more open than blink-1`,
    );
    assert.ok(
      countOpaquePixels(face, halfClose, eyeRegion)
        > countOpaquePixels(face, fullClose, eyeRegion),
      `${facing} blink-1 must retain more eyelid geometry than blink-2`,
    );
  }

  for (const facing of FACINGS) {
    for (let phase = 0; phase < 6; phase += 1) {
      const messyCell = 24 + FACINGS.indexOf(facing) * 6 + phase;
      const bounds = alphaBounds(hair, messyCell);
      assert.ok(bounds?.pixels > 50, `missing messy hair ${facing}/${phase}`);
      assert.ok(bounds.minY >= 3);
      assert.ok(bounds.maxY <= 29, `hair ${facing}/${phase} crossed the jaw boundary`);
      assert.ok(bounds.maxX - bounds.minX <= 29, `hair ${facing}/${phase} became a helmet-width dome`);
    }
  }
  const hairColors = new Set();
  for (const facing of FACINGS) {
    for (let phase = 0; phase < 6; phase += 1) {
      const messyCell = 24 + FACINGS.indexOf(facing) * 6 + phase;
      for (let y = 0; y < FRAME_HEIGHT; y += 1) {
        for (let x = 0; x < FRAME_WIDTH; x += 1) {
          const [red, green, blue, alpha] = rgbaAt(hair, messyCell, x, y);
          if (alpha === 0) continue;
          hairColors.add(
            [red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join(""),
          );
        }
      }
    }
  }
  assert.deepEqual(
    [...hairColors].sort(),
    ["281d18", "543522", "70492e", "92623d"].sort(),
    "hair must use exactly three material fills plus the shared global outline",
  );

  for (const facing of FACINGS) {
    const resourceCell = FACINGS.indexOf(facing) * 16 + 14;
    const hammerCell = FACINGS.indexOf(facing) * 16 + 7;
    assert.ok(alphaBounds(held, resourceCell)?.pixels > 20, `missing ${facing} resource form`);
    assert.ok(alphaBounds(held, hammerCell)?.pixels > 20, `missing ${facing} hammer form`);
  }
  for (const statusCell of [0, 1, 2]) {
    assert.ok(alphaBounds(status, statusCell, 32, 32)?.pixels > 5);
  }
});
