/**
 * Renders a real "before" baseline of the CURRENT production `warm_springs`
 * region at native 1:1 scale (3072x3072 px, 96x96 tiles @ 32px).
 *
 * `warm_springs` uses the GENERIC region-map recipe path (there is no bespoke
 * painter for it, unlike Nirvana's `NirvanaPainter.ts`). The generic path's
 * terrain/scenery composition lives inside a large, stateful, browser-only
 * closure (`createCanvasPresentationRenderer` in
 * `src/renderer2d/production/CanvasPresentationRenderer.ts`) that needs a
 * real `HTMLCanvasElement` + DOM to drive. That closure is NOT modified or
 * imported wholesale here (too large/DOM-coupled to load headlessly within
 * a reasonable time-box). Instead this script:
 *
 *   1. Builds the REAL `RegionMapIdentity` for `warm_springs` from the actual
 *      backend config (`config/world.yaml`) via the REAL, unmodified
 *      `createRegionMapIdentity` (src/renderer2d/production/maps/RegionMapIdentity.ts).
 *   2. Generates the REAL production recipe via the REAL, unmodified
 *      `createRegionMapRecipe` (src/renderer2d/production/maps/RegionMapRecipe.ts)
 *      -- the same function every other (non-Nirvana) region in production uses.
 *   3. Reads the REAL, unmodified, exported frame-selection algorithms
 *      (`terrainRoleAt`, `terrainConnectionVariantIndex`, `terrainFrameVariantIndex`,
 *      `sceneryVariantIndex`) straight out of `CanvasPresentationRenderer.ts`'s
 *      public exports -- these are the exact functions production uses to
 *      decide which authored tile/scenery frame goes where.
 *   4. Reads the REAL asset pack for the `spring-terraces` kit via the REAL,
 *      unmodified `requireRegionAssetPack` (productionManifest.ts) -- the
 *      real atlas rects into the real `terrain.png` / `scenery.png` /
 *      `landmarks.png`.
 *   5. Composites terrain -> landmarks -> scenery (the same three-stage order
 *      `createCachePreparation`'s `advance()` uses) with a hand-rolled raw-RGBA
 *      `drawImage` backend, the same technique
 *      `render-nirvana-valley-pilot.mjs` uses for Node (no browser canvas).
 *
 * The only genuinely new code here is the small compositing WALK (which
 * tile/placement gets asked for a frame, and in what order) -- it mirrors
 * `createCachePreparation`'s `advance()` terrain/landmarks/scenery stages
 * line-for-line (see CanvasPresentationRenderer.ts:1352-1445), because those
 * three stages are private closure internals and cannot be imported directly.
 * Every DATA-BEARING step (recipe generation, frame selection, asset atlases)
 * is the real, unmodified production code.
 *
 * `runSeed`: in the live app this comes from the running backend session
 * (there is no fixed constant). This script uses a fixed representative seed
 * (1) since none is available offline; this affects exactly which authored
 * scenery/landmark variants and water-body/path positions are chosen, but not
 * the kit, the tile art, or the frame-selection algorithm.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { createServer } from "vite";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");
const REPO_ROOT = path.resolve(FRONTEND_ROOT, "..");
const DEFAULT_OUTPUT = path.resolve(
  REPO_ROOT,
  "docs/frontend/mockups/regions/warm-springs-pilot",
);
const REGION_ID = "warm_springs";
const RUN_SEED = 1;

// ---------------------------------------------------------------------------
// raw RGBA surface + a minimal drawImage blit (mirrors render-nirvana-valley-pilot.mjs)
// ---------------------------------------------------------------------------

function createSurface(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

async function loadSurface(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
  };
}

/** Integer 1:1 (or scaled) source-over blit; the only "drawImage" this script needs. */
function blit(surface, image, sx, sy, sw, sh, dx, dy, dw, dh) {
  const stepX = sw / dw;
  const stepY = sh / dh;
  for (let row = 0; row < dh; row += 1) {
    const targetY = dy + row;
    if (targetY < 0 || targetY >= surface.height) continue;
    const sourceY = sy + Math.floor(row * stepY);
    if (sourceY < 0 || sourceY >= image.height) continue;
    for (let column = 0; column < dw; column += 1) {
      const targetX = dx + column;
      if (targetX < 0 || targetX >= surface.width) continue;
      const sourceX = sx + Math.floor(column * stepX);
      if (sourceX < 0 || sourceX >= image.width) continue;
      const source = (sourceY * image.width + sourceX) * 4;
      const alpha = image.data[source + 3] / 255;
      if (alpha <= 0) continue;
      const target = (targetY * surface.width + targetX) * 4;
      if (alpha >= 1) {
        surface.data[target] = image.data[source];
        surface.data[target + 1] = image.data[source + 1];
        surface.data[target + 2] = image.data[source + 2];
        surface.data[target + 3] = 255;
        continue;
      }
      const destinationAlpha = surface.data[target + 3] / 255;
      const outAlpha = alpha + destinationAlpha * (1 - alpha);
      for (let channel = 0; channel < 3; channel += 1) {
        surface.data[target + channel] = Math.round(
          (image.data[source + channel] * alpha
            + surface.data[target + channel] * destinationAlpha * (1 - alpha)) / outAlpha,
        );
      }
      surface.data[target + 3] = Math.round(outAlpha * 255);
    }
  }
}

function fillRect(surface, x, y, w, h, [r, g, b]) {
  for (let row = 0; row < h; row += 1) {
    const targetY = y + row;
    if (targetY < 0 || targetY >= surface.height) continue;
    for (let column = 0; column < w; column += 1) {
      const targetX = x + column;
      if (targetX < 0 || targetX >= surface.width) continue;
      const index = (targetY * surface.width + targetX) * 4;
      surface.data[index] = r;
      surface.data[index + 1] = g;
      surface.data[index + 2] = b;
      surface.data[index + 3] = 255;
    }
  }
}

/** Mirrors `drawNeutralStaticPlaceholder` (CanvasPresentationRenderer.ts:6084-6097). */
function drawNeutralPlaceholder(surface, x, y, tileSize) {
  fillRect(surface, x, y, tileSize, tileSize, [0x68, 0x70, 0x6a]);
  fillRect(surface, x, y, tileSize / 2, tileSize / 2, [0x7b, 0x83, 0x7b]);
  fillRect(surface, x + tileSize / 2, y + tileSize / 2, tileSize / 2, tileSize / 2, [0x7b, 0x83, 0x7b]);
}

async function writePng(surface, file) {
  const png = await sharp(Buffer.from(surface.data.buffer, 0, surface.data.length), {
    raw: { width: surface.width, height: surface.height, channels: 4 },
  }).png({ compressionLevel: 9, palette: false }).toBuffer();
  await writeFile(file, png);
  return png.length;
}

// ---------------------------------------------------------------------------
// config/world.yaml -> RegionSnapshot[] (the real, current backend region data)
// ---------------------------------------------------------------------------

function parseWorldYamlRegions(yamlText) {
  const sectionMatch = yamlText.match(/^regions:\n([\s\S]*?)\nagents:/m);
  if (!sectionMatch) throw new Error("config/world.yaml: could not find a `regions:` section.");
  const blocks = sectionMatch[1]
    .split(/\n(?=\s{2}- name:)/)
    .map((block) => block.trim())
    .filter(Boolean);
  return blocks.map((block) => {
    const fields = {};
    for (const rawLine of block.split("\n")) {
      const line = rawLine.trim();
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      const key = line.slice(0, colon).replace(/^-\s*/, "").trim();
      const value = line.slice(colon + 1).trim();
      fields[key] = value;
    }
    const unquote = (value) => value.replace(/^"|"$/g, "");
    return {
      name: unquote(fields.name),
      description: unquote(fields.description),
      connections: JSON.parse(fields.connections),
      energy_rate: Number(fields.energy_rate),
      materials_rate: Number(fields.materials_rate),
      current_energy: Number(fields.current_energy),
      current_materials: Number(fields.current_materials),
      max_energy: Number(fields.max_energy),
      max_materials: Number(fields.max_materials),
    };
  });
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

export async function renderWarmSpringsBaseline(outputRoot = DEFAULT_OUTPUT) {
  const server = await createServer({
    root: FRONTEND_ROOT,
    configFile: path.join(FRONTEND_ROOT, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "warn",
  });
  try {
    const identityModule = await server.ssrLoadModule(
      "/src/renderer2d/production/maps/RegionMapIdentity.ts",
    );
    const recipeModule = await server.ssrLoadModule(
      "/src/renderer2d/production/maps/RegionMapRecipe.ts",
    );
    const manifestModule = await server.ssrLoadModule(
      "/src/renderer2d/production/assets/productionManifest.ts",
    );
    const rendererModule = await server.ssrLoadModule(
      "/src/renderer2d/production/CanvasPresentationRenderer.ts",
    );
    const regionMapModule = await server.ssrLoadModule(
      "/src/renderer2d/map/regionMap.ts",
    );
    const TILE_SIZE = regionMapModule.TILE_SIZE;

    const yamlText = await readFile(path.join(REPO_ROOT, "config/world.yaml"), "utf8");
    const regions = parseWorldYamlRegions(yamlText);
    const warmSprings = regions.find((region) => region.name === REGION_ID);
    if (warmSprings === undefined) {
      throw new Error(`config/world.yaml has no region named ${REGION_ID}.`);
    }

    const identity = identityModule.createRegionMapIdentity(RUN_SEED, warmSprings, regions);
    if (identity.archetype !== "spring_terraces") {
      throw new Error(`Expected warm_springs archetype spring_terraces, got ${identity.archetype}.`);
    }
    const recipe = recipeModule.createRegionMapRecipe(identity);
    if (recipe.kit !== "spring-terraces") {
      throw new Error(`Expected warm_springs kit spring-terraces, got ${recipe.kit}.`);
    }
    const pack = manifestModule.requireRegionAssetPack(recipe.kit);

    const assetRoot = path.join(FRONTEND_ROOT, "src/assets/renderer2d/regions/spring-terraces");
    const atlasSurfaces = {
      "spring-terraces-terrain": await loadSurface(path.join(assetRoot, "terrain.png")),
      "spring-terraces-scenery": await loadSurface(path.join(assetRoot, "scenery.png")),
      "spring-terraces-landmarks": await loadSurface(path.join(assetRoot, "landmarks.png")),
    };

    const width = recipe.grid.columns * TILE_SIZE;
    const height = recipe.grid.rows * TILE_SIZE;
    const surface = createSurface(width, height);

    /** Real production frame-selection functions, imported verbatim (not reimplemented). */
    const { terrainRoleAt, terrainFrameVariantIndex, sceneryVariantIndex } = rendererModule;

    const drawFrame = (frameRef, dx, dy, dw, dh) => {
      if (frameRef === undefined) {
        drawNeutralPlaceholder(surface, dx, dy, dw);
        return;
      }
      const atlas = atlasSurfaces[frameRef.atlasId];
      if (atlas === undefined) throw new Error(`Missing atlas surface for ${frameRef.atlasId}.`);
      const { rect } = frameRef;
      blit(surface, atlas, rect.x, rect.y, rect.width, rect.height, dx, dy, dw, dh);
    };

    // Stage 1: terrain, one draw per grid cell -- mirrors
    // CanvasPresentationRenderer.ts:1352-1378 (`stage === "terrain"`).
    const neighborOffsets = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    let terrainDraws = 0;
    let placeholderDraws = 0;
    for (let row = 0; row < recipe.grid.rows; row += 1) {
      for (let column = 0; column < recipe.grid.columns; column += 1) {
        const role = terrainRoleAt(recipe, column, row);
        let connections = 0;
        neighborOffsets.forEach(([deltaColumn, deltaRow], bit) => {
          if (terrainRoleAt(recipe, column + deltaColumn, row + deltaRow) === role) {
            connections |= 1 << bit;
          }
        });
        const frames = pack.terrainFramesByRole[role];
        const variant = terrainFrameVariantIndex(role, connections, column, row);
        const frameRef = frames?.[variant]?.frame;
        if (frameRef === undefined) placeholderDraws += 1;
        drawFrame(frameRef, column * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        terrainDraws += 1;
      }
    }

    // Stage 2: scenic landmarks -- mirrors CanvasPresentationRenderer.ts:1380-1404
    // (`stage === "landmarks"`) / `drawScenicLandmark` (lines 5984-6047).
    for (const landmark of recipe.scenicLandmarks) {
      const binding = pack.landmarkFrames[landmark.semanticKind];
      const variant = binding?.variants.find((entry) => entry.variantId === landmark.variantId);
      if (variant === undefined) {
        throw new Error(`No landmark variant for ${landmark.id} (${landmark.semanticKind}/${landmark.variantId}).`);
      }
      const x = landmark.contactTile.column * TILE_SIZE + TILE_SIZE / 2 - landmark.contactPivotPx.x;
      const y = landmark.contactTile.row * TILE_SIZE + TILE_SIZE / 2 - landmark.contactPivotPx.y;
      drawFrame(variant, x, y, binding.renderSizePx.width, binding.renderSizePx.height);
    }

    // Stage 3: static scenery, skipping placements a landmark has replaced -- mirrors
    // CanvasPresentationRenderer.ts:1310-1315 (`replacedClusterIds`/`visibleStaticScenery`)
    // and 1408-1444 (`stage === "scenery"`).
    const replacedClusterIds = new Set(recipe.scenicLandmarks.map((landmark) => landmark.clusterId));
    const visibleStaticScenery = recipe.staticScenery.filter(
      (placement) => placement.clusterId === null || !replacedClusterIds.has(placement.clusterId),
    );
    let sceneryDraws = 0;
    for (const placement of visibleStaticScenery) {
      const primaryFrame = pack.staticSceneryFrames[placement.kind];
      const variants = pack.staticSceneryVariants[placement.kind] ?? [];
      const sceneryFrame = primaryFrame === undefined
        ? undefined
        : variants[sceneryVariantIndex(
          placement.id,
          placement.tile.column,
          placement.tile.row,
          variants.length,
        )] ?? primaryFrame;
      drawFrame(sceneryFrame, placement.tile.column * TILE_SIZE, placement.tile.row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      sceneryDraws += 1;
    }

    await mkdir(outputRoot, { recursive: true });
    const outputFile = path.join(outputRoot, "00-warm-springs-current-baseline.png");
    const bytes = await writePng(surface, outputFile);

    return {
      outputFile,
      width,
      height,
      regionId: recipe.regionId,
      kit: recipe.kit,
      runSeed: RUN_SEED,
      identityHash: recipe.identityHash,
      terrainDraws,
      placeholderTerrainDraws: placeholderDraws,
      landmarkDraws: recipe.scenicLandmarks.length,
      staticSceneryTotal: recipe.staticScenery.length,
      staticSceneryVisible: visibleStaticScenery.length,
      sceneryDraws,
      bytes,
    };
  } finally {
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf("--out");
  const outputRoot = outIndex > 0 ? path.resolve(process.argv[outIndex + 1]) : DEFAULT_OUTPUT;
  renderWarmSpringsBaseline(outputRoot)
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 1)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
