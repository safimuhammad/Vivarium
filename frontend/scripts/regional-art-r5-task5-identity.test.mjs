import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

import sharp from "sharp";

import * as productionPacker from "./pack-2d-production-assets.mjs";
import { REGIONAL_R5_PALETTES } from "./regional-art-r5-authoring-spec.mjs";

const REGION_GUIDE = new URL(
  "../../scratchpad/2d-production-art/source/imagegen-concepts/region-kits-imagegen-guide.png",
  import.meta.url,
);
const HOME_RUIN_GUIDE = new URL(
  "../../scratchpad/2d-production-art/source/imagegen-concepts/home-ruin-imagegen-guide.png",
  import.meta.url,
);
const NATIVE_ASSET_ROOT = new URL(
  "../../scratchpad/2d-production-art/source/native/",
  import.meta.url,
);
const PUBLICATION_ROOTS = [
  new URL("../../frontend/public/assets/2d/", import.meta.url),
  new URL("../../scratchpad/2d-production-art/source/native/", import.meta.url),
  new URL("../../scratchpad/2d-production-art/evidence/", import.meta.url),
];
const FIVE_KITS = [
  "ash-waste",
  "dry-scrub",
  "spring-terraces",
  "neutral-temperate",
  "worn-heartland",
];
const TASK5_KITS = ["spring-terraces", "dry-scrub", "worn-heartland"];
const FAMILIES = ["terrain", "scenery", "landmarks", "yards", "composed"];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

let authoringPromise;
const regionalR5Authoring = async () => {
  authoringPromise ??= productionPacker.buildRegionalR5SourceMasters({
    sourceBuffers: {
      regionKits: await readFile(REGION_GUIDE),
      homeRuin: await readFile(HOME_RUIN_GUIDE),
    },
  });
  return authoringPromise;
};

const completeProofSources = async (kit) => ({
  homeComponents: await readFile(new URL(`homes/${kit}/components.png`, NATIVE_ASSET_ROOT)),
  humanBody: await readFile(new URL("core/human-body-rigs.png", NATIVE_ASSET_ROOT)),
  humanFace: await readFile(new URL("core/human-face-planes.png", NATIVE_ASSET_ROOT)),
  humanHair: await readFile(new URL("core/human-hair.png", NATIVE_ASSET_ROOT)),
  humanClothing: await readFile(new URL("core/human-clothing-00.png", NATIVE_ASSET_ROOT)),
});

const publicationSnapshot = async () => {
  const entries = [];
  const visit = async (url, prefix) => {
    let names;
    try {
      names = await readdir(url);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const name of names.sort()) {
      const child = new URL(`${name}${url.pathname.endsWith("/") ? "" : "/"}`, url);
      const metadata = await stat(child);
      const relative = `${prefix}/${name}`;
      if (metadata.isDirectory()) await visit(new URL(`${name}/`, url), relative);
      else entries.push([relative, sha256(await readFile(child))]);
    }
  };
  for (const [index, root] of PUBLICATION_ROOTS.entries()) await visit(root, String(index));
  return sha256(Buffer.from(JSON.stringify(entries)));
};

const decode = async (bytes) => {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
};

const crop = (raw, left, top, width, height) => {
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
};

const atlasCell = (atlas, cell) => ({
  data: crop(atlas, cell % 4 * 128, Math.floor(cell / 4) * 128, 128, 128),
  width: 128,
  height: 128,
  channels: 4,
});

const rgb = (hex) => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

const colorPoints = (raw, color) => {
  const expected = color.join(",");
  const points = [];
  for (let y = 0; y < raw.height; y += 1) for (let x = 0; x < raw.width; x += 1) {
    const offset = (y * raw.width + x) * 4;
    if (raw.data[offset + 3] !== 0
        && raw.data.subarray(offset, offset + 3).join(",") === expected) points.push([x, y]);
  }
  return points;
};

test("Task12R R5 Task 5 owns a separate exact 33-file proof-only closure", () => {
  assert.equal(typeof productionPacker.regionalR5Task5ProofArtifactNames, "function");
  const expected = [
    ...TASK5_KITS.flatMap((kit) => FAMILIES.flatMap((family) => [
      `task12r-r5-task5-${kit}-${family}-native-1x.png`,
      `task12r-r5-task5-${kit}-${family}-nearest-2x.png`,
    ])),
    "task12r-r5-task5-five-region-labels-hidden-native-1x.png",
    "task12r-r5-task5-all-40-landmarks-labels-hidden-native-1x.png",
    "task12r-r5-task5-manifest.json",
  ].sort();
  assert.equal(expected.length, 33);
  assert.deepEqual(productionPacker.regionalR5Task5ProofArtifactNames(), expected);
  assert.equal(productionPacker.regionalR5CompleteProofArtifactNames().length, 22,
    "the accepted Ash/Neutral Task 4 closure stays frozen and separate");
});

test("Task12R R5 blind repair gives the four failed landmark cells unambiguous source-pixel anatomy", async () => {
  const authoring = await regionalR5Authoring();
  const neutral = REGIONAL_R5_PALETTES.kits["neutral-temperate"];
  const pairedTrees = atlasCell(authoring.rawMasters["neutral-temperate-landmarks"], 1);
  const timber = colorPoints(pairedTrees, rgb(neutral["meadow-timber"]));
  const canopy = [
    ...colorPoints(pairedTrees, rgb(neutral["sage-dark"])),
    ...colorPoints(pairedTrees, rgb(neutral["sage-mid"])),
    ...colorPoints(pairedTrees, rgb(neutral["hedge-deep"])),
  ];
  assert.ok(canopy.length >= 4_200, `paired-tree landmark needs two large crowns (${canopy.length})`);
  assert.ok(timber.filter(([x, y]) => x >= 20 && x < 52 && y >= 48).length >= 280,
    "paired-tree landmark needs a substantial left trunk/root mass");
  assert.ok(timber.filter(([x, y]) => x >= 74 && x < 106 && y >= 48).length >= 280,
    "paired-tree landmark needs a substantial right trunk/root mass");
  assert.ok(canopy.filter(([x]) => x < 58).length >= 1_500
    && canopy.filter(([x]) => x >= 68).length >= 1_500,
  "paired-tree crowns must remain visibly bilateral rather than one tiny wedge");

  const spring = REGIONAL_R5_PALETTES.kits["spring-terraces"];
  const springAtlas = authoring.rawMasters["spring-terraces-landmarks"];
  const levels = atlasCell(springAtlas, 2);
  const stone = colorPoints(levels, rgb(spring["mineral-stone"]));
  const water = [
    ...colorPoints(levels, rgb(spring["deep-aqua"])),
    ...colorPoints(levels, rgb(spring["shallow-aqua"])),
  ];
  assert.ok(stone.filter(([, y]) => y >= 22 && y < 58).length >= 1_000,
    "two-level landmark needs a broad upper wet-stone shelf");
  assert.ok(stone.filter(([, y]) => y >= 72 && y < 112).length >= 1_200,
    "two-level landmark needs a broad lower wet-stone shelf");
  assert.ok(water.length >= 550, "two wet-stone levels need a visible aqua cascade/return");

  const gap = atlasCell(springAtlas, 3);
  const reeds = colorPoints(gap, rgb(spring.reed));
  assert.ok(reeds.filter(([x]) => x < 48).length >= 800,
    "broken-sight landmark needs a substantial left reed habitat");
  assert.ok(reeds.filter(([x]) => x >= 80).length >= 800,
    "broken-sight landmark needs a substantial right reed habitat");
  let centralOpaque = 0;
  for (let y = 18; y < 112; y += 1) for (let x = 52; x < 76; x += 1) {
    centralOpaque += gap.data[(y * 128 + x) * 4 + 3] === 0 ? 0 : 1;
  }
  assert.ok(centralOpaque <= 260,
    `broken-sight landmark needs one clear central sight gap (${centralOpaque}px occupied)`);

  const northSouth = atlasCell(springAtlas, 6);
  const planks = colorPoints(northSouth, rgb(spring["wet-timber"]));
  assert.ok(planks.length >= 2_200, `north-south boardwalk needs substantial timber (${planks.length}px)`);
  assert.ok(planks.filter(([x]) => x >= 30 && x < 98).length / planks.length >= 0.9,
    "north-south boardwalk timber must form one bounded vertical run");
  const occupiedPlankRows = new Set(planks.map(([, y]) => y));
  assert.ok(occupiedPlankRows.size >= 96
    && Math.min(...occupiedPlankRows) <= 2
    && Math.max(...occupiedPlankRows) >= 126,
  "north-south boardwalk timber must span the cell while retaining outline gaps between planks");
});

test("Task12R R5 blind repair strengthens Ash nuclear infrastructure and Neutral living meadow source layers", async () => {
  const authoring = await regionalR5Authoring();
  const ash = await productionPacker.buildRegionalR5KeyScene({ kit: "ash-waste", authoring });
  const neutral = await productionPacker.buildRegionalR5KeyScene({ kit: "neutral-temperate", authoring });
  assert.equal(ash.blindVisualRepair?.id, "task5-blind-repair/ash-nuclear-infrastructure");
  assert.equal(neutral.blindVisualRepair?.id, "task5-blind-repair/neutral-living-meadow");
  assert.equal(ash.blindVisualRepair?.sourceOwned, true);
  assert.equal(neutral.blindVisualRepair?.sourceOwned, true);
  assert.equal(ash.blindVisualRepair?.diagnosticOnly, true);
  assert.equal(neutral.blindVisualRepair?.diagnosticOnly, true);
  assert.equal(ash.blindVisualRepair?.finalSourceApproval, false);
  assert.equal(neutral.blindVisualRepair?.finalSourceApproval, false);
  assert.equal(ash.blindVisualRepair?.atlasRuntimeReconstructible, false);
  assert.equal(neutral.blindVisualRepair?.atlasRuntimeReconstructible, false);
  assert.equal(ash.blindVisualRepair?.task6Reconstructible, false);
  assert.equal(neutral.blindVisualRepair?.task6Reconstructible, false);
  assert.match(ash.blindVisualRepair?.rgbaSha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.match(neutral.blindVisualRepair?.rgbaSha256 ?? "", /^[a-f0-9]{64}$/u);

  const ashPalette = REGIONAL_R5_PALETTES.kits["ash-waste"];
  const ashRepair = ash.blindVisualRepair.raw;
  const concrete = colorPoints(ashRepair, rgb(ashPalette["containment-concrete"]));
  const metal = colorPoints(ashRepair, rgb(ashPalette["oxidized-metal"]));
  const lime = colorPoints(ashRepair, rgb(ashPalette["hazard-lime"]));
  assert.ok(concrete.length >= 7_000 && metal.length >= 3_000,
    "Ash repair needs scene-scale cooling/containment and service anatomy");
  assert.ok(concrete.some(([x, y]) => x < 180 && y < 280)
    && concrete.some(([x, y]) => x > 600 && y < 190),
  "Ash source repair must join monitoring and cooling structures across the scene");
  assert.ok(lime.length >= 80 && lime.length <= 600,
    `Ash hazard cues must be restrained but readable (${lime.length}px)`);

  const neutralPalette = REGIONAL_R5_PALETTES.kits["neutral-temperate"];
  const neutralRepair = neutral.blindVisualRepair.raw;
  const living = [
    ...colorPoints(neutralRepair, rgb(neutralPalette["sage-dark"])),
    ...colorPoints(neutralRepair, rgb(neutralPalette["sage-mid"])),
    ...colorPoints(neutralRepair, rgb(neutralPalette["hedge-deep"])),
  ];
  const flowers = colorPoints(neutralRepair, rgb(neutralPalette.wildflower));
  const pond = [
    ...colorPoints(neutralRepair, rgb(neutralPalette["pond-deep"])),
    ...colorPoints(neutralRepair, rgb(neutralPalette["pond-light"])),
  ];
  assert.ok(living.length >= 10_000, "Neutral repair needs scene-scale living meadow/grove mass");
  assert.ok(flowers.length >= 500, "Neutral repair needs joined warm wildflower habitat");
  assert.ok(pond.length >= 2_000, "Neutral repair needs an unmistakable temperate pond return");
});

test("Task12R R5 Task 5 builds byte-truthful labels-hidden five-region and all-40-landmark boards", async () => {
  assert.equal(typeof productionPacker.buildRegionalR5Task5ProofArtifacts, "function");
  const authoring = await regionalR5Authoring();
  const sources = Object.fromEntries(await Promise.all(FIVE_KITS.map(async (kit) => [
    kit,
    await completeProofSources(kit),
  ])));
  const before = await publicationSnapshot();
  const result = await productionPacker.buildRegionalR5Task5ProofArtifacts({
    authoring,
    sourceBuffersByKit: sources,
  });
  const after = await publicationSnapshot();
  assert.equal(after, before, "in-memory Task 5 proof building publishes no native/runtime/evidence bytes");
  assert.deepEqual(result.inventory, productionPacker.regionalR5Task5ProofArtifactNames());
  assert.deepEqual(Object.keys(result.artifacts), result.inventory);
  assert.equal(result.manifest.schema, "regional-r5-task5-proof-artifacts/v1");
  assert.equal(result.manifest.proofOnly, true);
  assert.equal(result.manifest.published, false);
  assert.equal(result.manifest.embeddedLabels, false);
  assert.equal(result.manifest.sourceSceneProofOnly, true);
  assert.equal(result.manifest.directSceneSourcesPresent, true);
  assert.equal(result.manifest.diagnosticSceneTargetsPresent, true);
  assert.equal(result.manifest.finalSceneSourceApproval, false);
  assert.equal(result.manifest.atlasRuntimeReconstructible, false);
  assert.equal(result.manifest.task6Ready, false);
  assert.deepEqual(result.manifest.deferredGates, ["atlas-only-scene-reconstruction"]);
  assert.deepEqual(result.manifest.limitations,
    [
      "direct-scene-source-placements-are-not-yet-reconstructed-from-the-20-atlas-masters",
      "ash-neutral-blind-repair-scene-targets-are-diagnostic-only",
    ]);
  assert.deepEqual(result.manifest.task5Kits, TASK5_KITS);
  assert.deepEqual(result.manifest.identityBoard.kits, FIVE_KITS);
  assert.deepEqual(result.manifest.landmarkBoard.kits, FIVE_KITS);
  assert.equal(result.manifest.artifacts.length, 32);
  assert.deepEqual(result.manifest.artifacts.map(({ name }) => name),
    result.inventory.filter((name) => name !== "task12r-r5-task5-manifest.json"));

  for (const kit of TASK5_KITS) for (const family of FAMILIES) {
    const nativeName = `task12r-r5-task5-${kit}-${family}-native-1x.png`;
    const expected = family === "composed"
      ? (await productionPacker.buildRegionalR5CompleteProofScene({
        kit,
        authoring,
        sourceBuffers: sources[kit],
      })).buffer
      : authoring.buffers[`${kit}-${family === "yards" ? "home-yards" : family}`];
    assert.equal(sha256(result.artifacts[nativeName]), sha256(expected),
      `${kit}/${family}: native Task 5 artifact must preserve exact accepted source bytes`);
  }

  const sceneBoardName = "task12r-r5-task5-five-region-labels-hidden-native-1x.png";
  const sceneBoard = await decode(result.artifacts[sceneBoardName]);
  assert.deepEqual([sceneBoard.width, sceneBoard.height, sceneBoard.channels], [2304, 1024, 4]);
  for (const [index, kit] of FIVE_KITS.entries()) {
    const scene = await productionPacker.buildRegionalR5CompleteProofScene({
      kit,
      authoring,
      sourceBuffers: sources[kit],
    });
    const left = index % 3 * 768;
    const top = Math.floor(index / 3) * 512;
    assert.equal(sha256(crop(sceneBoard, left, top, 768, 512)), sha256(scene.raw.data),
      `${kit}: labels-hidden board slot must be the exact current complete scene with no painted label`);
  }
  assert.equal(new Set(crop(sceneBoard, 1536, 512, 768, 512)).size, 1,
    "the unused sixth scene slot stays transparent and cannot contain a legend or label");

  const landmarkBoardName = "task12r-r5-task5-all-40-landmarks-labels-hidden-native-1x.png";
  const landmarkBoard = await decode(result.artifacts[landmarkBoardName]);
  assert.deepEqual([landmarkBoard.width, landmarkBoard.height, landmarkBoard.channels], [1536, 512, 4]);
  const cellDigests = [];
  for (const [kitIndex, kit] of FIVE_KITS.entries()) {
    const atlas = authoring.rawMasters[`${kit}-landmarks`];
    const boardLeft = kitIndex % 3 * 512;
    const boardTop = Math.floor(kitIndex / 3) * 256;
    assert.equal(sha256(crop(landmarkBoard, boardLeft, boardTop, 512, 256)), sha256(atlas.data),
      `${kit}: landmark board block must reproduce the exact current eight-cell atlas`);
    for (let cell = 0; cell < 8; cell += 1) {
      const sourceLeft = cell % 4 * 128;
      const sourceTop = Math.floor(cell / 4) * 128;
      const bytes = crop(atlas, sourceLeft, sourceTop, 128, 128);
      assert.notEqual(new Set(bytes).size, 1, `${kit}/${cell}: landmark cell cannot be blank`);
      cellDigests.push(sha256(bytes));
    }
  }
  assert.equal(cellDigests.length, 40);
  assert.equal(new Set(cellDigests).size, 40, "all 40 landmark cells must remain independently addressable");
  assert.equal(new Set(crop(landmarkBoard, 1024, 256, 512, 256)).size, 1,
    "the unused sixth landmark-atlas slot stays transparent and label-free");

  assert.equal(result.manifest.blindReview.humanReviewRequired, true);
  assert.deepEqual(result.manifest.blindReview.ash.requiredRead,
    ["hostile", "contaminated", "nuclear-industrial"]);
  assert.deepEqual(result.manifest.blindReview.ash.forbiddenReads,
    ["generic-dark", "volcanic", "medieval", "fantasy"]);
  assert.equal(result.manifest.identityBoard.pngSha256,
    "f5e0feeac6156140a62907354ea6e5f0fa0376dce556c123dd4a74a10518eea5");
  assert.equal(result.manifest.identityBoard.rgbaSha256,
    "afbd704e942d30136044d9435debf307f07d092036b6a7c8d5fd34b024d193f7");
  assert.equal(result.manifest.landmarkBoard.pngSha256,
    "f9910e9aa54e65f8351c06ffcfeb39f59056f5c715a35401a5326a4ac58ef86c");
  assert.equal(result.manifest.landmarkBoard.rgbaSha256,
    "e0a7046ff9de4d8cec1786230717c6d4d3399ce7ec3cc8869dcb8dc8f633d7a7");
  assert.equal(result.manifest.identityBoard.receipts.find(({ kit }) => kit === "ash-waste").rgbaSha256,
    sha256(crop(sceneBoard, 0, 0, 768, 512)),
  "Ash blind-review input must bind the exact accepted current source scene rather than an inferred recolor");
});

test("Task12R R5 Task 5 proof closure fails closed on renamed, missing, extra, and tampered sources", async () => {
  const authoring = await regionalR5Authoring();
  const valid = Object.fromEntries(await Promise.all(FIVE_KITS.map(async (kit) => [
    kit,
    await completeProofSources(kit),
  ])));
  const renamed = { ...valid, "ash-contaminated": valid["ash-waste"] };
  delete renamed["ash-waste"];
  const missing = { ...valid };
  delete missing["dry-scrub"];
  const extra = { ...valid, "oracle-extra": valid["ash-waste"] };
  for (const candidate of [renamed, missing, extra]) {
    await assert.rejects(
      productionPacker.buildRegionalR5Task5ProofArtifacts({ authoring, sourceBuffersByKit: candidate }),
      /exact|five|source|kit/i,
    );
  }
  const tampered = {
    ...valid,
    "ash-waste": { ...valid["ash-waste"], humanHair: Buffer.from(valid["ash-waste"].humanHair) },
  };
  tampered["ash-waste"].humanHair[64] ^= 0xff;
  await assert.rejects(
    productionPacker.buildRegionalR5Task5ProofArtifacts({ authoring, sourceBuffersByKit: tampered }),
    /hash drift|ash-waste|humanHair/i,
  );
});
