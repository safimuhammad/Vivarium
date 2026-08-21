import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

import sharp from "sharp";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "../..");
const PUBLISHER_PATH = path.join(SCRIPT_DIR, "build-nirvana-v2-pilot-atlas.mjs");
const SOURCE_PATH = path.join(
  REPOSITORY_ROOT,
  "scratchpad/2d-production-art/source/imagegen-concepts/worn-heartland-landmarks-approved.png",
);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const execFileAsync = promisify(execFile);

const pixelAlpha = (raw, x, y) =>
  raw.data[(y * raw.info.width + x) * raw.info.channels + 3];

const opaqueBounds = (raw, frame) => {
  let minimumX = frame.rect.x + frame.rect.width;
  let minimumY = frame.rect.y + frame.rect.height;
  let maximumX = frame.rect.x - 1;
  let maximumY = frame.rect.y - 1;
  for (let y = frame.rect.y; y < frame.rect.y + frame.rect.height; y += 1) {
    for (let x = frame.rect.x; x < frame.rect.x + frame.rect.width; x += 1) {
      if (pixelAlpha(raw, x, y) <= 8) continue;
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
  }
  assert.ok(maximumX >= minimumX && maximumY >= minimumY, `${frame.id}: empty frame`);
  return {
    width: maximumX - minimumX + 1,
    height: maximumY - minimumY + 1,
  };
};

test("publishes a newly generated Nirvana asset set through one atomic pointer", async (context) => {
  const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), "vivarium-nirvana-v2-publisher-"));
  context.after(() => rm(isolatedRoot, { recursive: true, force: true }));
  const outputDirectory = path.join(isolatedRoot, "regions", "nirvana-v2");
  const generationsDirectory = path.join(
    path.dirname(outputDirectory),
    `.${path.basename(outputDirectory)}-generations`,
  );
  const previousGeneration = path.join(generationsDirectory, "previous");
  await mkdir(previousGeneration, { recursive: true });
  const previousFiles = {
    "atlas.json": "previous manifest\n",
    "landmarks.png": "previous landmarks\n",
    "terrain.png": "previous terrain\n",
  };
  await Promise.all(Object.entries(previousFiles).map(([name, contents]) => (
    writeFile(path.join(previousGeneration, name), contents)
  )));
  const previousLink = path.relative(path.dirname(outputDirectory), previousGeneration);
  await symlink(previousLink, outputDirectory, "dir");

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [PUBLISHER_PATH, "--output-dir", outputDirectory],
    { cwd: REPOSITORY_ROOT },
  );
  assert.equal(stderr, "");
  const publication = JSON.parse(stdout);
  assert.equal(path.resolve(publication.outputDirectory), outputDirectory);
  assert.equal(publication.frames, 50);

  const outputMetadata = await lstat(outputDirectory);
  assert.equal(outputMetadata.isSymbolicLink(), true, "publication must switch one symlink");
  const publishedLink = await readlink(outputDirectory);
  assert.notEqual(publishedLink, previousLink, "publication must switch generations");
  for (const [name, contents] of Object.entries(previousFiles)) {
    assert.equal(
      await readFile(path.join(previousGeneration, name), "utf8"),
      contents,
      `the previous complete generation must retain ${name} for in-flight readers`,
    );
  }
  assert.deepEqual(
    (await readdir(outputDirectory)).sort(),
    ["atlas.json", "landmarks.png", "terrain.png"],
  );

  const [manifestBytes, terrainBytes, landmarkBytes, sourceBytes] = await Promise.all([
    readFile(path.join(outputDirectory, "atlas.json")),
    readFile(path.join(outputDirectory, "terrain.png")),
    readFile(path.join(outputDirectory, "landmarks.png")),
    readFile(SOURCE_PATH),
  ]);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const [terrainMetadata, landmarkMetadata, terrainRaw, landmarkRaw, sourceMetadata] =
    await Promise.all([
      sharp(terrainBytes).metadata(),
      sharp(landmarkBytes).metadata(),
      sharp(terrainBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(landmarkBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(sourceBytes).metadata(),
    ]);

  assert.equal(manifest.schema, 1);
  assert.equal(manifest.tileSize, 32);
  assert.deepEqual(
    manifest.source,
    {
      file: "scratchpad/2d-production-art/source/imagegen-concepts/worn-heartland-landmarks-approved.png",
      width: sourceMetadata.width,
      height: sourceMetadata.height,
      sha256: sha256(sourceBytes),
    },
  );

  const expectedImages = {
    terrain: {
      file: "terrain.png",
      width: terrainMetadata.width,
      height: terrainMetadata.height,
      compressedBytes: terrainBytes.byteLength,
      decodedBytes: terrainMetadata.width * terrainMetadata.height * 4,
      sha256: sha256(terrainBytes),
    },
    landmarks: {
      file: "landmarks.png",
      width: landmarkMetadata.width,
      height: landmarkMetadata.height,
      compressedBytes: landmarkBytes.byteLength,
      decodedBytes: landmarkMetadata.width * landmarkMetadata.height * 4,
      sha256: sha256(landmarkBytes),
    },
  };
  assert.deepEqual(manifest.images, expectedImages);
  assert.equal(terrainMetadata.format, "png");
  assert.equal(landmarkMetadata.format, "png");
  assert.equal(terrainMetadata.width % 32, 0);
  assert.equal(terrainMetadata.height % 32, 0);
  for (let offset = 3; offset < terrainRaw.data.length; offset += terrainRaw.info.channels) {
    assert.equal(terrainRaw.data[offset], 255, "the terrain atlas must remain fully opaque");
  }

  const ids = manifest.frames.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, "frame IDs must be globally unique");
  assert.ok(ids.length > 0, "the atlas must publish frames");

  const requiredTerrainFrames = [
    "terrain.grass.olive.0",
    "terrain.grass.worn.0",
    "terrain.garden.floor.0",
    "terrain.road.straight.ns",
    "terrain.road.straight.ew",
    "terrain.road.corner.ne",
    "terrain.road.tee.n",
    "terrain.road.cross",
    "terrain.road.end.n",
    "terrain.swale.straight.ew",
    "terrain.swale.corner.ne",
    "terrain.swale.corner.sw",
    "terrain.ford.ns",
  ];
  const requiredLandmarkFrames = [
    "landmark.hero-oak",
    "landmark.forest-edge.cluster.0",
    "landmark.ruined-garden",
    "landmark.meadow-edge.north",
    "landmark.meadow-edge.west",
    "landmark.garden.wall",
    "landmark.garden.corner",
    "landmark.garden.broken-wall",
    "landmark.garden.gate",
    "landmark.flower-colony",
    "landmark.shrub",
    "landmark.tall-grass",
    "landmark.rocks",
    "landmark.log",
    "landmark.stump",
  ];
  for (const id of [...requiredTerrainFrames, ...requiredLandmarkFrames]) {
    assert.ok(ids.includes(id), `missing required reusable frame ${id}`);
  }

  for (const id of [
    "landmark.forest-edge.cluster.0",
    "landmark.forest-edge.cluster.1",
  ]) {
    const frame = manifest.frames.find((candidate) => candidate.id === id);
    assert.deepEqual(frame.rect, { x: id.endsWith(".0") ? 128 : 256, y: 0, width: 128, height: 128 });
    assert.deepEqual(frame.pivot, { x: 64, y: 124 });
    const bounds = opaqueBounds(landmarkRaw, frame);
    const maximumDimension = Math.max(bounds.width, bounds.height);
    assert.ok(
      maximumDimension <= 112,
      `${id}: forest silhouette is oversized at ${bounds.width}x${bounds.height}`,
    );
    assert.ok(
      maximumDimension >= 104,
      `${id}: forest silhouette was shrunk too far at ${bounds.width}x${bounds.height}`,
    );
  }

  for (const frame of manifest.frames) {
    const image = manifest.images[frame.image];
    assert.ok(image, `${frame.id}: unknown image ${frame.image}`);
    const { x, y, width, height } = frame.rect;
    assert.ok([x, y, width, height].every(Number.isInteger), `${frame.id}: non-integer rect`);
    assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0, `${frame.id}: invalid rect`);
    assert.ok(x + width <= image.width && y + height <= image.height, `${frame.id}: rect exceeds atlas`);
    assert.ok(Number.isInteger(frame.pivot.x) && Number.isInteger(frame.pivot.y), `${frame.id}: invalid pivot`);
    assert.ok(frame.pivot.x >= 0 && frame.pivot.x <= width, `${frame.id}: pivot x outside frame`);
    assert.ok(frame.pivot.y >= 0 && frame.pivot.y <= height, `${frame.id}: pivot y outside frame`);

    if (frame.image === "terrain") {
      assert.equal(width, 32, `${frame.id}: terrain width`);
      assert.equal(height, 32, `${frame.id}: terrain height`);
      assert.equal(x % 32, 0, `${frame.id}: terrain x alignment`);
      assert.equal(y % 32, 0, `${frame.id}: terrain y alignment`);
    } else {
      const corners = [
        [x, y],
        [x + width - 1, y],
        [x, y + height - 1],
        [x + width - 1, y + height - 1],
      ];
      for (const [cornerX, cornerY] of corners) {
        assert.equal(
          pixelAlpha(landmarkRaw, cornerX, cornerY),
          0,
          `${frame.id}: landmark frame corners must stay transparent`,
        );
      }
    }
  }

  const atlasCorners = [
    [0, 0],
    [landmarkRaw.info.width - 1, 0],
    [0, landmarkRaw.info.height - 1],
    [landmarkRaw.info.width - 1, landmarkRaw.info.height - 1],
  ];
  for (const [x, y] of atlasCorners) {
    assert.equal(pixelAlpha(landmarkRaw, x, y), 0, "landmark atlas corners must be transparent");
  }

  for (const frame of manifest.frames.filter(({ id }) => /^terrain\.(?:grass|garden)/.test(id))) {
    let minimumLuminance = Number.POSITIVE_INFINITY;
    let maximumLuminance = Number.NEGATIVE_INFINITY;
    let darkPixels = 0;
    for (let y = frame.rect.y; y < frame.rect.y + frame.rect.height; y += 1) {
      for (let x = frame.rect.x; x < frame.rect.x + frame.rect.width; x += 1) {
        const offset = (y * terrainRaw.info.width + x) * terrainRaw.info.channels;
        const luminance =
          terrainRaw.data[offset] * 0.2126
          + terrainRaw.data[offset + 1] * 0.7152
          + terrainRaw.data[offset + 2] * 0.0722;
        minimumLuminance = Math.min(minimumLuminance, luminance);
        maximumLuminance = Math.max(maximumLuminance, luminance);
        if (luminance < 70) darkPixels += 1;
      }
    }
    assert.ok(
      maximumLuminance - minimumLuminance < 55,
      `${frame.id}: ground texture contains foreground-scale contrast`,
    );
    assert.equal(darkPixels, 0, `${frame.id}: ground texture contains root/outline-dark pixels`);
  }
});

test("keeps production as the sole Nirvana V2 asset owner", async () => {
  const obsoletePilotDirectory = path.join(
    REPOSITORY_ROOT,
    "frontend/src/assets/renderer2d/pilots/nirvana-v2",
  );
  await assert.rejects(access(obsoletePilotDirectory), { code: "ENOENT" });
});
