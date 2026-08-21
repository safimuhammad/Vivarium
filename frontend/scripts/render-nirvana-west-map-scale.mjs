/**
 * Nirvana West pilot — the map-scale legibility plate.
 *
 * Nirvana West is the SMALLEST island in the world (carrying capacity 50 + 10 = 60
 * against a world maximum of 260, so `islandFillFraction` gives it 0.606 — close to
 * the 0.50 floor). That makes world-map legibility a first-class design driver here
 * rather than an afterthought, and it makes the island CLIP the dominant fact:
 *
 *   region            tiles projecting onto land at map scale
 *   nirvana                 98.3 %
 *   warm_springs            98.3 %
 *   nirvana_east            47.4 %
 *   nirvana_west            36.0 %   <-- two thirds of the region is never seen
 *
 * So this script does not just downsample. It runs the REAL, unmodified
 * `buildIslandMask` + `islandMapFit` + `pointInIslandMask` from
 * `src/renderer2d/production/world/islandMask.ts`, projects each 3072x3072 plate
 * through the same fit the world map uses, and clips it with the region's own
 * silhouette — so what you see is what the world map will show, including what it
 * throws away.
 *
 * Emits, per composition: a raw downsample at three sizes and an island-clipped
 * render at the same sizes, plus the current production baseline for comparison.
 * Also prints the distinct-colour count at 96 px (5-bit quantisation), which is the
 * number this whole revamp exists to move: Nirvana West today is 10 colours with
 * 94.2 % of the picture a single mauve.
 *
 * Usage:  node scripts/render-nirvana-west-map-scale.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { createServer } from "vite";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");
const REPO_ROOT = path.resolve(FRONTEND_ROOT, "..");
const PLATE_ROOT = path.resolve(REPO_ROOT, "docs/frontend/mockups/regions/nirvana-west-pilot");

const REGION_ID = "nirvana_west";
const KIT = "ash-waste";
/** max_energy 50 + max_materials 10, against warm_springs' 130 + 130 = 260. */
const CAPACITY = 60;
const MAX_CAPACITY = 260;
/** `nirvana_west.connections` = ["warm_springs", "nirvana"] -> two capes. */
const NEIGHBOUR_COUNT = 2;
const PLOT_PX = 3072;

const COMPOSITIONS = ["a-ashfall-drifts", "b-ember-rift", "c-shattered-pavement"];
const SIZES = [72, 152, 268];
const BACKDROP = [12, 11, 16];
const SEA = [10, 12, 20];

async function loadRgb(file, size) {
  const { data, info } = await sharp(file)
    .resize(size, size, { kernel: "lanczos3" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

/**
 * Map-scale richness at 96 px, measured only over the tiles that actually survive
 * the island clip.
 *
 * Colour count is the metric Warm Springs reported, and it is kept for continuity.
 * But for THIS region the decisive number is the **luminance spread**, because
 * Nirvana West's identity is value, not hue — it is the world's only dark region,
 * and value is what survives a downsample. The current production region measures a
 * p10–p90 luminance range of **0.3 of 255** across its island: it is not "mostly one
 * colour", it is one colour. Any composition worth shipping has to move that number
 * by two orders of magnitude.
 */
async function mapScaleStats(file, keep) {
  const { data } = await sharp(file).resize(96, 96, { kernel: "lanczos3" }).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const seen = new Set();
  const histogram = new Map();
  const clipSeen = new Set();
  const clipHistogram = new Map();
  const luminance = [];
  for (let index = 0; index < 96 * 96; index += 1) {
    const offset = index * 3;
    const key = ((data[offset] >> 3) << 10) | ((data[offset + 1] >> 3) << 5) | (data[offset + 2] >> 3);
    seen.add(key);
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
    if (keep[index] !== 1) continue;
    clipSeen.add(key);
    clipHistogram.set(key, (clipHistogram.get(key) ?? 0) + 1);
    luminance.push(0.3 * data[offset] + 0.59 * data[offset + 1] + 0.11 * data[offset + 2]);
  }
  let top = 0;
  for (const count of histogram.values()) if (count > top) top = count;
  let clipTop = 0;
  for (const count of clipHistogram.values()) if (count > clipTop) clipTop = count;
  luminance.sort((left, right) => left - right);
  const at = (fraction) => luminance[Math.min(luminance.length - 1, Math.floor(fraction * luminance.length))] ?? 0;
  const p10 = at(0.1);
  const p90 = at(0.9);
  return {
    colours: seen.size,
    dominantShare: top / (96 * 96),
    clippedColours: clipSeen.size,
    clippedDominantShare: clipHistogram.size === 0 ? 0 : clipTop / luminance.length,
    luminanceP10: p10,
    luminanceP90: p90,
    luminanceRange: p90 - p10,
  };
}

function paste(canvas, canvasWidth, image, ox, oy) {
  for (let row = 0; row < image.height; row += 1) {
    for (let col = 0; col < image.width; col += 1) {
      const source = (row * image.width + col) * 3;
      const target = ((oy + row) * canvasWidth + ox + col) * 3;
      canvas[target] = image.data[source];
      canvas[target + 1] = image.data[source + 1];
      canvas[target + 2] = image.data[source + 2];
    }
  }
}

/**
 * Run the REAL cartographic generalization pass the world map applies
 * (`generalizeMapInset`), on a 640 px inset, and report its diagnostics.
 *
 * This is the check that matters most for Nirvana West, for two reasons the code
 * states itself. First, the pass amplifies each field pixel's real deviation from
 * the field mean toward a legible sigma, capped at 2.2x — so a value ladder gets
 * PUSHED APART at island scale, but so does any banding or noise artefact in the
 * materials. Second, it reports `uniformField`, which is precisely the failure this
 * region is being rescued from: the production region today reads as one uniform
 * material, and a composition that still trips that flag has not fixed anything.
 *
 * It also reports the minimum-stroke widening for linear features (water radius 3 ->
 * 7 raster px, linework radius 2 -> 5 px, plus crossings). Features under roughly
 * 3-4 tiles vanish anyway — Nirvana's bridges and Warm Springs' boardwalks both do —
 * so this is how each composition's crossings are judged for map-scale survival
 * rather than assumed to survive.
 */
async function generalizeAtMapScale(file, generalization, size = 640) {
  const { data, info } = await sharp(file)
    .resize(size, size, { kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
  const image = { width: info.width, height: info.height, data: pixels, colorSpace: "srgb" };
  const report = generalization.generalizeMapInset(image);
  return {
    generalized: { width: info.width, height: info.height, data: Buffer.from(pixels.buffer, pixels.byteOffset, pixels.length) },
    uniformField: report.uniformField,
    fieldToneGain: Number(report.fieldToneGain.toFixed(3)),
    waterContrastGain: Number(report.waterContrastGain.toFixed(3)),
    waterPx: report.waterPx,
    widenedWaterPx: report.widenedWaterPx,
    linePx: report.linePx,
    widenedLinePx: report.widenedLinePx,
    crossingPx: report.crossingPx,
    widenedCrossingPx: report.widenedCrossingPx,
  };
}

/** Project a plate through the real map fit and clip it with the real silhouette. */
function clipToIsland(image, mask, fit, islandModule) {
  const out = { width: image.width, height: image.height, data: Buffer.alloc(image.width * image.height * 3) };
  for (let row = 0; row < image.height; row += 1) {
    for (let col = 0; col < image.width; col += 1) {
      const target = (row * image.width + col) * 3;
      // image pixel -> plot-local pixel through the same uniform-scale fit the map uses
      const px = ((col + 0.5) / image.width) * fit.width + fit.x;
      const py = ((row + 0.5) / image.height) * fit.height + fit.y;
      if (islandModule.pointInIslandMask(mask, px, py)) {
        out.data[target] = image.data[target];
        out.data[target + 1] = image.data[target + 1];
        out.data[target + 2] = image.data[target + 2];
      } else {
        out.data[target] = SEA[0];
        out.data[target + 1] = SEA[1];
        out.data[target + 2] = SEA[2];
      }
    }
  }
  return out;
}

export async function renderNirvanaWestMapScale(plateRoot = PLATE_ROOT) {
  const server = await createServer({
    root: FRONTEND_ROOT,
    configFile: path.join(FRONTEND_ROOT, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "warn",
  });
  try {
    const islandModule = await server.ssrLoadModule(
      "/src/renderer2d/production/world/islandMask.ts",
    );
    const generalization = await server.ssrLoadModule(
      "/src/renderer2d/production/world/mapGeneralization.ts",
    );
    const fill = islandModule.islandFillFraction(CAPACITY, MAX_CAPACITY);
    const capeAngles = Array.from(
      { length: NEIGHBOUR_COUNT },
      (_, index) => (index * 2 * Math.PI) / NEIGHBOUR_COUNT + 0.7,
    );
    const mask = islandModule.buildIslandMask({
      regionId: REGION_ID,
      kit: KIT,
      widthPx: PLOT_PX,
      heightPx: PLOT_PX,
      capeAngles,
      fill,
    });
    const fit = islandModule.islandMapFit(mask, PLOT_PX, PLOT_PX);

    // how much of the region survives the clip -- the headline constraint
    let onLand = 0;
    const keep = new Uint8Array(96 * 96);
    for (let row = 0; row < 96; row += 1) {
      for (let col = 0; col < 96; col += 1) {
        const px = ((col + 0.5) / 96) * fit.width + fit.x;
        const py = ((row + 0.5) / 96) * fit.height + fit.y;
        if (islandModule.pointInIslandMask(mask, px, py)) {
          onLand += 1;
          keep[row * 96 + col] = 1;
        }
      }
    }

    const plates = [
      ...COMPOSITIONS.map((id) => ({ id, file: path.join(plateRoot, `${id}.png`) })),
      { id: "today", file: path.join(plateRoot, "00-nirvana-west-current-baseline.png") },
    ];

    const gap = 18;
    const columnWidth = Math.max(...SIZES) + gap;
    const rowHeights = SIZES.flatMap((size) => [size, size]);
    const canvasWidth = plates.length * columnWidth + gap;
    const canvasHeight = rowHeights.reduce((sum, height) => sum + height + gap, gap);
    const canvas = Buffer.alloc(canvasWidth * canvasHeight * 3);
    for (let i = 0; i < canvasWidth * canvasHeight; i += 1) {
      canvas[i * 3] = BACKDROP[0];
      canvas[i * 3 + 1] = BACKDROP[1];
      canvas[i * 3 + 2] = BACKDROP[2];
    }

    const stats = [];
    for (const [index, plate] of plates.entries()) {
      let y = gap;
      for (const size of SIZES) {
        const raw = await loadRgb(plate.file, size);
        const ox = gap + index * columnWidth + Math.floor((Math.max(...SIZES) - size) / 2);
        paste(canvas, canvasWidth, raw, ox, y);
        y += size + gap;
        const clipped = clipToIsland(raw, mask, fit, islandModule);
        paste(canvas, canvasWidth, clipped, ox, y);
        y += size + gap;
      }
      const { generalized, ...diagnostics } = await generalizeAtMapScale(plate.file, generalization);
      void generalized;
      stats.push({
        id: plate.id,
        ...(await mapScaleStats(plate.file, keep)),
        generalization: diagnostics,
      });
    }

    await mkdir(plateRoot, { recursive: true });
    const outputFile = path.join(plateRoot, "map-scale.png");
    const png = await sharp(canvas, { raw: { width: canvasWidth, height: canvasHeight, channels: 3 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(outputFile, png);

    return {
      outputFile,
      bytes: png.length,
      islandFill: Number(fill.toFixed(4)),
      mapFit: { x: fit.x, y: fit.y, width: fit.width, height: fit.height },
      regionTilesOnLand: onLand,
      regionTilesTotal: 9216,
      regionTilesOnLandPercent: Number(((100 * onLand) / 9216).toFixed(1)),
      mapScale: stats.map((entry) => ({
        id: entry.id,
        colours: entry.colours,
        dominantSharePercent: Number((100 * entry.dominantShare).toFixed(1)),
        clippedColours: entry.clippedColours,
        clippedDominantSharePercent: Number((100 * entry.clippedDominantShare).toFixed(1)),
        luminanceP10: Number(entry.luminanceP10.toFixed(1)),
        luminanceP90: Number(entry.luminanceP90.toFixed(1)),
        luminanceRange: Number(entry.luminanceRange.toFixed(1)),
        generalization: entry.generalization,
      })),
    };
  } finally {
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  renderNirvanaWestMapScale()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 1)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
