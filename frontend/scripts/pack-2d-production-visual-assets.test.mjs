import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME = path.join(ROOT, "frontend/src/assets/renderer2d");
const NATIVE = path.join(ROOT, "scratchpad/2d-production-art/source/native");
const EVIDENCE = path.join(ROOT, "scratchpad/2d-production-art/evidence");
const PACKER_SOURCE = path.join(ROOT, "frontend/scripts/pack-2d-production-assets.mjs");

const KITS = [
  "worn-heartland",
  "spring-terraces",
  "dry-scrub",
  "ash-waste",
  "neutral-temperate",
];
const FACINGS = ["south", "east", "north", "west"];
const BODY_ACTIONS = [
  ["idle", 4], ["walk", 6], ["run", 8], ["turn", 2], ["stop", 2],
  ["reach-give", 6], ["work", 6], ["hurt-fall", 6], ["prone", 2], ["dead", 1],
];
const HOME_STATES = [
  "cold",
  "lit",
  "doorway",
  "damaged",
  "collapse",
  "ruin-full",
  "ruin-picked",
  "ruin-bare",
];
const REQUIRED_EVIDENCE = [
  "task8-gold-master-approval-1x.png",
  "contact-sheet-human-1x.png",
  "contact-sheet-human-2x.png",
  "joe-human-b-south-idle2-coils-cell144-4x.png",
  "contact-sheet-regions-1x.png",
  "contact-sheet-homes-1x.png",
  "contact-sheet-desktop-1440x900.png",
  "contact-sheet-mobile-390x844.png",
  "ash-waste-production-scene-1440x900.png",
];

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function rawImage(file) {
  return sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function extractCellAlpha(image, index, columns, cellWidth, cellHeight) {
  const originX = (index % columns) * cellWidth;
  const originY = Math.floor(index / columns) * cellHeight;
  const mask = new Uint8Array(cellWidth * cellHeight);
  for (let y = 0; y < cellHeight; y += 1) {
    for (let x = 0; x < cellWidth; x += 1) {
      const source = ((originY + y) * image.info.width + originX + x) * image.info.channels;
      mask[y * cellWidth + x] = image.data[source + 3] === 0 ? 0 : 1;
    }
  }
  return mask;
}

function extractCellRgba(image, index, columns, cellWidth, cellHeight) {
  const originX = (index % columns) * cellWidth;
  const originY = Math.floor(index / columns) * cellHeight;
  const pixels = new Uint8Array(cellWidth * cellHeight * 4);
  for (let y = 0; y < cellHeight; y += 1) {
    for (let x = 0; x < cellWidth; x += 1) {
      const source = ((originY + y) * image.info.width + originX + x) * image.info.channels;
      const destination = (y * cellWidth + x) * 4;
      pixels[destination] = image.data[source];
      pixels[destination + 1] = image.data[source + 1];
      pixels[destination + 2] = image.data[source + 2];
      pixels[destination + 3] = image.data[source + 3];
    }
  }
  return pixels;
}

function subjectMaskFromOpaqueContactSheet(image, index, columns, cellWidth, cellHeight) {
  const originX = (index % columns) * cellWidth;
  const originY = Math.floor(index / columns) * cellHeight;
  const background = [180, 188, 132];
  const mask = new Uint8Array(cellWidth * cellHeight);
  for (let y = 0; y < cellHeight; y += 1) {
    for (let x = 0; x < cellWidth; x += 1) {
      const source = ((originY + y) * image.info.width + originX + x) * image.info.channels;
      const isBackground = background.every((value, channel) => image.data[source + channel] === value);
      mask[y * cellWidth + x] = isBackground ? 0 : 1;
    }
  }
  return mask;
}

function connectedComponents(mask, width, height) {
  const remaining = Uint8Array.from(mask);
  const sizes = [];
  for (let seed = 0; seed < remaining.length; seed += 1) {
    if (remaining[seed] === 0) continue;
    remaining[seed] = 0;
    const stack = [seed];
    let size = 0;
    while (stack.length > 0) {
      const pixel = stack.pop();
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      size += 1;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (remaining[next] === 0) continue;
          remaining[next] = 0;
          stack.push(next);
        }
      }
    }
    sizes.push(size);
  }
  return sizes.sort((left, right) => right - left);
}

function alphaDistance(left, right) {
  assert.equal(left.length, right.length);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) difference += 1;
  }
  return difference;
}

function cellHash(image, index, columns, cellWidth, cellHeight) {
  return sha256(extractCellRgba(image, index, columns, cellWidth, cellHeight));
}

function opaqueColors(image, index, columns, cellWidth, cellHeight) {
  const cell = extractCellRgba(image, index, columns, cellWidth, cellHeight);
  const colors = new Set();
  for (let offset = 0; offset < cell.length; offset += 4) {
    if (cell[offset + 3] !== 0) colors.add(`${cell[offset]},${cell[offset + 1]},${cell[offset + 2]}`);
  }
  return colors;
}

async function wholeAtlasAlpha(file) {
  const image = await rawImage(file);
  const mask = new Uint8Array(image.info.width * image.info.height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    mask[pixel] = image.data[pixel * image.info.channels + 3] === 0 ? 0 : 1;
  }
  return mask;
}

function bodyCellLabel(index) {
  const local = index - 172;
  const facingIndex = Math.floor(local / 43);
  let phase = local % 43;
  for (const [action, count] of BODY_ACTIONS) {
    if (phase < count) return `rig-b/${FACINGS[facingIndex]}/${action}/${phase}`;
    phase -= count;
  }
  return `rig-b/unknown/${index}`;
}

test("rig-B native and runtime action cells reject detached decomposition fragments", async () => {
  const failures = [];
  for (const file of [
    path.join(NATIVE, "core/human-body-rigs.png"),
    path.join(RUNTIME, "core/human-body-rigs.png"),
  ]) {
    const image = await rawImage(file);
    assert.equal(image.info.width, 768);
    assert.equal(image.info.height, 1408);
    for (let index = 172; index < 344; index += 1) {
      const components = connectedComponents(extractCellAlpha(image, index, 16, 48, 64), 48, 64);
      if (components.length !== 1) {
        failures.push(`${path.relative(ROOT, file)} ${bodyCellLabel(index)} components=${components.slice(0, 8).join(",")}`);
      }
    }
  }

  const contactSheet = await rawImage(path.join(EVIDENCE, "contact-sheet-human-1x.png"));
  for (let index = 32; index < 64; index += 1) {
    const components = connectedComponents(
      subjectMaskFromOpaqueContactSheet(contactSheet, index, 8, 48, 64),
      48,
      64,
    ).filter((size) => size >= 3);
    if (components.length !== 1) {
      failures.push(`contact-sheet-human-1x rig-b cell=${index - 32} components=${components.slice(0, 8).join(",")}`);
    }
  }

  assert.deepEqual(failures, [], failures.slice(0, 24).join("\n"));
});

test("all eight clothing atlases have pairwise-distinct alpha silhouettes by at least 64 pixels", async () => {
  for (const root of [path.join(NATIVE, "core"), path.join(RUNTIME, "core")]) {
    const masks = await Promise.all(Array.from({ length: 8 }, (_unused, index) => (
      wholeAtlasAlpha(path.join(root, `human-clothing-${String(index).padStart(2, "0")}.png`))
    )));
    const failures = [];
    for (let left = 0; left < masks.length; left += 1) {
      for (let right = left + 1; right < masks.length; right += 1) {
        const difference = alphaDistance(masks[left], masks[right]);
        if (difference < 64) failures.push(`${left}/${right} alpha difference=${difference}`);
      }
    }
    const unique = new Set(masks.map((mask) => sha256(mask)));
    if (unique.size !== 8) failures.push(`unique alpha silhouettes=${unique.size}, expected=8`);
    assert.deepEqual(failures, [], `${path.relative(ROOT, root)}\n${failures.join("\n")}`);
  }
});

test("all eight clothing silhouettes differ meaningfully in every representative native cell", async () => {
  const representatives = [
    ["standing-south", 0],
    ["standing-east", 43],
    ["standing-north", 86],
    ["standing-west", 129],
    ["walking-south", 4],
    ["walking-east", 47],
    ["work-south", 28],
    ["work-west", 157],
    ["grounded-prone", 40],
  ];
  for (const root of [path.join(NATIVE, "core"), path.join(RUNTIME, "core")]) {
    const images = await Promise.all(Array.from({ length: 8 }, (_unused, index) => (
      rawImage(path.join(root, `human-clothing-${String(index).padStart(2, "0")}.png`))
    )));
    const failures = [];
    for (const [label, cellIndex] of representatives) {
      const masks = images.map((image) => extractCellAlpha(image, cellIndex, 16, 48, 64));
      for (let left = 0; left < masks.length; left += 1) {
        for (let right = left + 1; right < masks.length; right += 1) {
          const difference = alphaDistance(masks[left], masks[right]);
          if (difference < 64) {
            failures.push(`${label} ${left}/${right} alpha difference=${difference}, expected>=64`);
          }
        }
      }
    }
    assert.deepEqual(failures, [], `${path.relative(ROOT, root)}\n${failures.slice(0, 48).join("\n")}`);
  }
});

test("human evidence carries distinct clothing and hair survey rows at native 1x", async () => {
  const image = await rawImage(path.join(EVIDENCE, "contact-sheet-human-1x.png"));
  assert.equal(image.info.width, 384);
  assert.equal(image.info.height, 640, "eight clothing and eight hair cells require two added 64px rows");
  const failures = [];
  const clothingCells = Array.from({ length: 8 }, (_unused, index) => (
    extractCellRgba(image, 64 + index, 8, 48, 64)
  ));
  const hairCells = Array.from({ length: 8 }, (_unused, index) => (
    extractCellRgba(image, 72 + index, 8, 48, 64)
  ));
  for (const [label, cells, threshold] of [
    ["clothing", clothingCells, 64],
    ["hair", hairCells, 32],
  ]) {
    if (new Set(cells.map((cell) => sha256(cell))).size !== 8) {
      failures.push(`${label} evidence row must contain eight unique visible cells`);
    }
    for (let left = 0; left < cells.length; left += 1) {
      for (let right = left + 1; right < cells.length; right += 1) {
        const difference = alphaDistance(cells[left], cells[right]);
        if (difference < threshold) failures.push(`${label} ${left}/${right} difference=${difference}`);
      }
    }
  }
  assert.deepEqual(failures, [], failures.slice(0, 48).join("\n"));
});

test("all biome terrain rejects flat-color collapse, repeated perimeter cells, and chroma residue", async () => {
  for (const root of [NATIVE, RUNTIME]) {
    for (const kit of KITS) {
      const terrain = await rawImage(path.join(root, `regions/${kit}/terrain.png`));
      const legal = Array.from({ length: 36 }, (_unused, index) => index);
      for (const cell of legal) {
        const colors = opaqueColors(terrain, cell, 8, 32, 32);
        assert.ok(colors.size >= 4, `${path.relative(ROOT, root)}/${kit} cell ${cell} collapsed to ${colors.size} colors`);
        assert.ok(
          [...colors].every((color) => {
            const [red, green, blue] = color.split(",").map(Number);
            return !(red > 210 && blue > 170 && green < 100);
          }),
          `${path.relative(ROOT, root)}/${kit} cell ${cell} contains guide chroma`,
        );
      }
      const groundHashes = new Set(Array.from({ length: 8 }, (_unused, index) => cellHash(terrain, index, 8, 32, 32)));
      const shoreHashes = new Set(Array.from({ length: 8 }, (_unused, index) => cellHash(terrain, 24 + index, 8, 32, 32)));
      assert.ok(groundHashes.size >= 7, `${kit} ground texture variants=${groundHashes.size}`);
      assert.ok(shoreHashes.size >= 7, `${kit} perimeter/shore variants=${shoreHashes.size}`);
    }
  }
});

test("each scenery kind has a broad bank of visibly distinct native silhouettes", async () => {
  const contract = JSON.parse(await readFile(path.join(NATIVE, "production-native-contract.json"), "utf8"));
  for (const root of [NATIVE, RUNTIME]) {
    for (const kit of KITS) {
      const scenery = await rawImage(path.join(root, `regions/${kit}/scenery.png`));
      const variants = contract.atlases[`${kit}-scenery`].semanticSceneryVariants;
      for (const [kind, cells] of Object.entries(variants)) {
        const hashes = new Set(cells.map((cell) => cellHash(scenery, cell, 16, 32, 32)));
        const alphaHashes = new Set(cells.map((cell) => sha256(extractCellAlpha(scenery, cell, 16, 32, 32))));
        assert.ok(hashes.size >= 28, `${kit}/${kind} rgba variants=${hashes.size}`);
        assert.ok(alphaHashes.size >= 12, `${kit}/${kind} silhouette variants=${alphaHashes.size}`);
      }
    }
  }
});

test("all five home kits prove distinct native assemblies and eight truthful lifecycle states", async () => {
  const failures = [];
  const componentMasks = new Map();
  const ruinMasks = new Map();
  for (const kit of KITS) {
    componentMasks.set(kit, await wholeAtlasAlpha(path.join(RUNTIME, `homes/${kit}/components.png`)));
    ruinMasks.set(kit, await wholeAtlasAlpha(path.join(RUNTIME, `homes/${kit}/ruins.png`)));
  }
  for (let left = 0; left < KITS.length; left += 1) {
    for (let right = left + 1; right < KITS.length; right += 1) {
      const componentDifference = alphaDistance(componentMasks.get(KITS[left]), componentMasks.get(KITS[right]));
      const ruinDifference = alphaDistance(ruinMasks.get(KITS[left]), ruinMasks.get(KITS[right]));
      if (componentDifference < 64) failures.push(`${KITS[left]}/${KITS[right]} component alpha difference=${componentDifference}`);
      if (ruinDifference < 64) failures.push(`${KITS[left]}/${KITS[right]} ruin alpha difference=${ruinDifference}`);
    }
  }

  const matrix = JSON.parse(await readFile(path.join(EVIDENCE, "visual-review-matrix.json"), "utf8"));
  if (!matrix.homeStateEvidence || typeof matrix.homeStateEvidence !== "object") {
    failures.push("visual-review-matrix.homeStateEvidence is missing");
  } else {
    const coldAlpha = new Map();
    for (const kit of KITS) {
      const states = matrix.homeStateEvidence[kit];
      if (!states || typeof states !== "object") {
        failures.push(`${kit} home state evidence is missing`);
        continue;
      }
      const stateHashes = new Set();
      for (const state of HOME_STATES) {
        const evidence = states[state];
        if (!evidence || typeof evidence !== "object") {
          failures.push(`${kit}/${state} evidence is missing`);
          continue;
        }
        const rect = evidence.rect;
        if (!rect || rect.width !== 128 || rect.height !== 128
          || ![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger)) {
          failures.push(`${kit}/${state} must identify one native 128x128 integer crop`);
          continue;
        }
        const source = path.join(EVIDENCE, evidence.file);
        const crop = await sharp(source).extract(rect).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const actualHash = sha256(crop.data);
        if (actualHash !== evidence.sha256) failures.push(`${kit}/${state} crop hash mismatch`);
        stateHashes.add(actualHash);
        if (state === "cold") {
          const mask = new Uint8Array(128 * 128);
          for (let pixel = 0; pixel < mask.length; pixel += 1) mask[pixel] = crop.data[pixel * 4 + 3] === 0 ? 0 : 1;
          coldAlpha.set(kit, mask);
        }
      }
      if (stateHashes.size !== HOME_STATES.length) {
        failures.push(`${kit} distinct lifecycle state hashes=${stateHashes.size}, expected=${HOME_STATES.length}`);
      }
    }
    for (let left = 0; left < KITS.length; left += 1) {
      for (let right = left + 1; right < KITS.length; right += 1) {
        if (!coldAlpha.has(KITS[left]) || !coldAlpha.has(KITS[right])) continue;
        const difference = alphaDistance(coldAlpha.get(KITS[left]), coldAlpha.get(KITS[right]));
        if (difference < 64) failures.push(`${KITS[left]}/${KITS[right]} assembled cold alpha difference=${difference}`);
      }
    }
  }
  assert.deepEqual(failures, [], failures.slice(0, 32).join("\n"));
});

test("regional home identity is authored in runtime/native architectural component cells", async () => {
  const architecturalCells = [
    ["foundation", 0],
    ["post", 1],
    ["wall-intact", 2],
    ["roof-intact", 6],
    ["door-open", 13],
  ];
  for (const root of [NATIVE, RUNTIME]) {
    const byKit = new Map();
    for (const kit of KITS) {
      const image = await rawImage(path.join(root, `homes/${kit}/components.png`));
      byKit.set(kit, architecturalCells.map(([_label, index]) => (
        extractCellAlpha(image, index, 6, 128, 128)
      )));
    }
    const failures = [];
    for (let left = 0; left < KITS.length; left += 1) {
      for (let right = left + 1; right < KITS.length; right += 1) {
        const differences = architecturalCells.map((_entry, index) => (
          alphaDistance(byKit.get(KITS[left])[index], byKit.get(KITS[right])[index])
        ));
        const total = differences.reduce((sum, value) => sum + value, 0);
        const materiallyDifferentCells = differences.filter((value) => value >= 32).length;
        if (total < 256 || materiallyDifferentCells < 3) {
          failures.push(`${KITS[left]}/${KITS[right]} total=${total}, meaningfulCells=${materiallyDifferentCells}, perCell=${differences.join(",")}`);
        }
      }
    }
    assert.deepEqual(failures, [], `${path.relative(ROOT, root)}\n${failures.join("\n")}`);
  }
});

test("home evidence compositor assembles native atlas cells without drawing kit geometry", async () => {
  const source = await readFile(PACKER_SOURCE, "utf8");
  const start = source.indexOf("async function assembledHomeState");
  const end = source.indexOf("async function goldMasterApprovalSheet", start);
  assert.ok(start >= 0 && end > start, "expected assembledHomeState source boundary");
  const compositor = source.slice(start, end);
  assert.doesNotMatch(
    compositor,
    /createSurface\s*\(|outlinedRect\s*\(|fillRect\s*\(|ellipse\s*\(|\bline\s*\(|\bpixel\s*\(/,
    "home evidence may crop, shift, and composite native cells but may not author new kit/home geometry",
  );
});

test("packing report owns every visual artifact and matrix records explicit pass outcomes", async () => {
  const report = JSON.parse(await readFile(path.join(EVIDENCE, "packing-report.json"), "utf8"));
  const matrix = JSON.parse(await readFile(path.join(EVIDENCE, "visual-review-matrix.json"), "utf8"));
  const requiredVerdicts = {
    "task8-gold-master-approval-1x.png": [
      "directional-anatomy", "face-plane", "regional-identity", "home-scale",
      "component-separation", "pixel-discipline", "budgets",
    ],
    "contact-sheet-human-1x.png": ["directional-anatomy", "face-plane", "pixel-discipline"],
    "contact-sheet-human-2x.png": ["directional-anatomy", "face-plane", "pixel-discipline"],
    "joe-human-b-south-idle2-coils-cell144-4x.png": [
      "directional-anatomy", "face-plane", "pixel-discipline",
    ],
    "contact-sheet-regions-1x.png": ["regional-identity", "pixel-discipline"],
    "contact-sheet-homes-1x.png": ["home-scale", "component-separation", "pixel-discipline"],
    "contact-sheet-desktop-1440x900.png": [
      "directional-anatomy", "regional-identity", "home-scale", "responsive-readability",
    ],
    "contact-sheet-mobile-390x844.png": [
      "directional-anatomy", "regional-identity", "home-scale", "responsive-readability",
    ],
    "ash-waste-production-scene-1440x900.png": [
      "regional-identity", "pixel-discipline", "responsive-readability",
    ],
  };
  const failures = [];
  for (const name of REQUIRED_EVIDENCE) {
    const bytes = await readFile(path.join(EVIDENCE, name));
    const record = report.evidence?.[name];
    if (!record) failures.push(`packing report does not own ${name}`);
    else {
      if (record.sha256 !== sha256(bytes)) failures.push(`${name} report hash mismatch`);
      if (record.compressedBytes !== bytes.length) failures.push(`${name} report byte count mismatch`);
    }
    const artifact = matrix.artifacts?.[name];
    if (!artifact) {
      failures.push(`visual matrix artifact is missing ${name}`);
      continue;
    }
    if (artifact.sha256 !== sha256(bytes)) failures.push(`${name} matrix hash mismatch`);
    for (const verdict of requiredVerdicts[name]) {
      const outcome = artifact.verdicts?.[verdict];
      if (outcome?.status !== "pass") {
        failures.push(`${name} verdict ${verdict} must be explicit pass`);
      }
      if (!/^[a-f0-9]{64}$/.test(outcome?.validationResultSha256 ?? "")) {
        failures.push(`${name} verdict ${verdict} must link a validation-result hash`);
      }
    }
  }
  assert.deepEqual(failures, [], failures.join("\n"));
  assert.deepEqual(report.productionSceneEvidence.sceneryKinds,
    ["charred-trunk", "slag-rock", "ash-pile", "bone-stone"]);
  assert.deepEqual(report.productionSceneEvidence.repeatedKinds,
    ["charred-trunk", "slag-rock", "ash-pile", "bone-stone"]);
  assert.deepEqual(report.productionSceneEvidence.viewport, { width: 1440, height: 900 });
  assert.equal(report.productionSceneEvidence.file, "ash-waste-production-scene-1440x900.png");
  assert.equal(report.productionSceneEvidence.kit, "ash-waste");
  assert.ok(report.productionSceneEvidence.distinctVariantCells.length >= 24);
  assert.ok(report.productionSceneEvidence.clusterSize >= 3 && report.productionSceneEvidence.clusterSize <= 7);
  assert.ok(report.productionSceneEvidence.openInteractionRect.width >= 320);
  assert.ok(report.productionSceneEvidence.openInteractionRect.height >= 224);
  assert.ok(report.productionSceneEvidence.pathTiles >= 32);
  assert.ok(report.productionSceneEvidence.emberEffects >= 4);
});
