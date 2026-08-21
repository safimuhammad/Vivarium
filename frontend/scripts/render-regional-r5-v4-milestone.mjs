/** Bounded milestone renderer for one-to-four human-reviewed V4 frames. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import sharp from "sharp";

import {
  REGIONAL_R5_V4_SCENE_FIRST_LITERAL_AUTHORITY,
} from "./fixtures/regional-art-r5-v4-scene-first-literal-authority.mjs";
import {
  buildRegionalR5AtlasOnlyScenes,
  buildRegionalR5DynamicPresentationScenes,
  buildRegionalR5V4SceneFirstMasters,
} from "./pack-2d-production-assets.mjs";

const KITS = Object.freeze([
  "ash-waste", "dry-scrub", "neutral-temperate", "spring-terraces", "worn-heartland",
]);
const NATIVE_ROOT = new URL("../../scratchpad/2d-production-art/source/native/", import.meta.url);

function frameLimit(argv) {
  const option = argv.find((value) => value.startsWith("--frames="));
  const value = Number(option?.slice("--frames=".length) ?? 2);
  if (!Number.isSafeInteger(value) || value < 1 || value > 4) {
    throw new RangeError("V4 milestone evidence is bounded to one through four frames");
  }
  return value;
}

function outputDirectory(argv) {
  const option = argv.find((value) => value.startsWith("--out="));
  return path.resolve(option?.slice("--out=".length) ?? "/tmp/vivarium-r5-v4-milestone");
}

async function pngForRaw(raw) {
  return sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .png({ adaptiveFiltering: false, compressionLevel: 9, palette: false })
    .toBuffer();
}

async function board(scenes, kits) {
  const columns = Math.min(3, kits.length);
  const rows = Math.ceil(kits.length / columns);
  const inputs = await Promise.all(kits.map(async (kit, index) => ({
    input: await pngForRaw(scenes[kit].raw),
    left: index % columns * 768,
    top: Math.floor(index / columns) * 512,
  })));
  return sharp({
    create: { width: columns * 768, height: rows * 512, channels: 4,
      background: { r: 28, g: 28, b: 36, alpha: 1 } },
  }).composite(inputs).png({ adaptiveFiltering: false, compressionLevel: 9 }).toBuffer();
}

async function dynamicSources(masterBuffers) {
  const buffers = {};
  for (const kit of KITS) {
    buffers[`${kit}-home-yards`] = Buffer.from(masterBuffers[`${kit}-home-yards`]);
    buffers[`${kit}-home-components`] = await readFile(
      new URL(`homes/${kit}/components.png`, NATIVE_ROOT),
    );
  }
  for (const name of [
    "human-body-rigs", "human-face-planes", "human-hair", "human-clothing-00",
  ]) buffers[`core-${name}`] = await readFile(new URL(`core/${name}.png`, NATIVE_ROOT));
  return buffers;
}

/** Render a deliberately bounded visual witness set without browser or provider access. */
export async function renderRegionalR5V4Milestone(argv = process.argv.slice(2)) {
  const limit = frameLimit(argv);
  const output = outputDirectory(argv);
  await mkdir(output, { recursive: true });
  const built = await buildRegionalR5V4SceneFirstMasters({
    authority: REGIONAL_R5_V4_SCENE_FIRST_LITERAL_AUTHORITY,
  });
  const staticScenes = await buildRegionalR5AtlasOnlyScenes({
    masterBuffers: built.masterBuffers,
    placements: built.placements,
    authoringIdentity: built.authoringIdentity,
  });
  const dynamicScenes = await buildRegionalR5DynamicPresentationScenes({
    staticScenes,
    dynamicSourceBuffers: await dynamicSources(built.masterBuffers),
    placements: built.dynamicPlacements,
  });
  const frames = [
    ["01-static-five-regions.png", await board(staticScenes.scenes, KITS)],
    ["02-dynamic-five-regions.png", await board(dynamicScenes.scenes, KITS)],
    ["03-ash-dry-close.png", await board(dynamicScenes.scenes, ["ash-waste", "dry-scrub"])],
    ["04-inhabited-wet-worn-close.png", await board(dynamicScenes.scenes,
      ["neutral-temperate", "spring-terraces", "worn-heartland"])],
  ].slice(0, limit);
  await Promise.all(frames.map(([name, bytes]) => writeFile(path.join(output, name), bytes)));
  return Object.freeze(frames.map(([name]) => path.join(output, name)));
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  await renderRegionalR5V4Milestone();
}
