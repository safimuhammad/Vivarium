/**
 * Renders the Warm Springs geothermal PILOT (all three compositions) to
 * native-scale PNGs, plus a map-scale legibility strip.
 *
 * Clone of `render-nirvana-valley-pilot.mjs`'s raw-RGBA `drawImage` backend
 * and PNG capture discipline. The scene, frame vocabulary, and paint plan all
 * come from the pilot's TypeScript modules, loaded through Vite's SSR loader,
 * and executed by the PRODUCTION `drawProductionStaticSceneOperation`.
 *
 * Emits, per composition, into
 * `docs/frontend/mockups/regions/warm-springs-pilot/`:
 *   <id>.png            the region at 1:1, 3072x3072
 *   <id>-walkable.png   blocked-cell tint + all 128 shelter plots outlined
 *                        (green = clear, red filled = lost)
 *   <id>-detail.png     a 1536x1024 1:1 crop at the composition's most
 *                        characteristic spot
 *   <id>-routes.png     the REAL findNavigationPath route across every
 *                        boardwalk, drawn tile by tile on the art
 * plus one shared `map-scale.png`: all three, downsampled to island size,
 * RAW and clipped by the `spring_terraces` island mask, beside the shipped
 * Nirvana region at the same scale.
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
const NIRVANA_WORLD_MAP = path.resolve(
  REPO_ROOT,
  "scratchpad/being-sprite-evidence/nirvana-live/world-map-nirvana.png",
);

const MINERAL_MATERIALS = new Set([
  "poolhot", "pool", "poolrim", "sinter", "travertine", "ochre", "mud",
]);

// ---------------------------------------------------------------------------
// raw RGBA surface + the minimal 2D context the production draw op needs
// (identical to render-nirvana-valley-pilot.mjs)
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

function createContext(surface) {
  return {
    imageSmoothingEnabled: false,
    canvas: { width: surface.width, height: surface.height },
    surface,
    drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh) {
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
    },
    clearRect() {},
  };
}

async function writePng(surface, file) {
  const png = await sharp(Buffer.from(surface.data.buffer, 0, surface.data.length), {
    raw: { width: surface.width, height: surface.height, channels: 4 },
  }).png({ compressionLevel: 9, palette: false }).toBuffer();
  await writeFile(file, png);
  return png.length;
}

function cropSurface(surface, x, y, width, height) {
  const cropped = createSurface(width, height);
  for (let row = 0; row < height; row += 1) {
    const sourceY = y + row;
    if (sourceY < 0 || sourceY >= surface.height) continue;
    for (let column = 0; column < width; column += 1) {
      const sourceX = x + column;
      if (sourceX < 0 || sourceX >= surface.width) continue;
      const source = (sourceY * surface.width + sourceX) * 4;
      const target = (row * width + column) * 4;
      cropped.data[target] = surface.data[source];
      cropped.data[target + 1] = surface.data[source + 1];
      cropped.data[target + 2] = surface.data[source + 2];
      cropped.data[target + 3] = surface.data[source + 3];
    }
  }
  return cropped;
}

/** Nearest-neighbour box-average downsample - good enough for a legibility thumbnail. */
function downsample(surface, targetWidth) {
  const scale = targetWidth / surface.width;
  const targetHeight = Math.max(1, Math.round(surface.height * scale));
  const out = createSurface(targetWidth, targetHeight);
  for (let row = 0; row < targetHeight; row += 1) {
    const sy0 = Math.floor((row / targetHeight) * surface.height);
    const sy1 = Math.max(sy0 + 1, Math.floor(((row + 1) / targetHeight) * surface.height));
    for (let column = 0; column < targetWidth; column += 1) {
      const sx0 = Math.floor((column / targetWidth) * surface.width);
      const sx1 = Math.max(sx0 + 1, Math.floor(((column + 1) / targetWidth) * surface.width));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const index = (sy * surface.width + sx) * 4;
          r += surface.data[index];
          g += surface.data[index + 1];
          b += surface.data[index + 2];
          a += surface.data[index + 3];
          count += 1;
        }
      }
      const target = (row * targetWidth + column) * 4;
      out.data[target] = r / count;
      out.data[target + 1] = g / count;
      out.data[target + 2] = b / count;
      out.data[target + 3] = a / count;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// overlays
// ---------------------------------------------------------------------------

function tintBlockedCells(surface, scene) {
  const tinted = createSurface(surface.width, surface.height);
  tinted.data.set(surface.data);
  const { collision, columns, rows, tileSize } = scene;
  const blockedAt = (column, row) => (
    column < 0 || row < 0 || column >= columns || row >= rows
      ? 1
      : collision[row * columns + column]
  );
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (collision[row * columns + column] !== 1) continue;
      const edgeN = blockedAt(column, row - 1) === 0;
      const edgeS = blockedAt(column, row + 1) === 0;
      const edgeW = blockedAt(column - 1, row) === 0;
      const edgeE = blockedAt(column + 1, row) === 0;
      for (let y = 0; y < tileSize; y += 1) {
        for (let x = 0; x < tileSize; x += 1) {
          const px = column * tileSize + x;
          const py = row * tileSize + y;
          if (px >= surface.width || py >= surface.height) continue;
          const index = (py * surface.width + px) * 4;
          const onBorder = (edgeN && y === 0) || (edgeS && y === tileSize - 1)
            || (edgeW && x === 0) || (edgeE && x === tileSize - 1);
          const hatch = ((x + y) % 8) < 2;
          const strength = onBorder ? 0.92 : hatch ? 0.46 : 0.24;
          tinted.data[index] = Math.round(tinted.data[index] * (1 - strength) + 226 * strength);
          tinted.data[index + 1] = Math.round(tinted.data[index + 1] * (1 - strength) + 44 * strength);
          tinted.data[index + 2] = Math.round(tinted.data[index + 2] * (1 - strength) + 62 * strength);
          tinted.data[index + 3] = 255;
        }
      }
    }
  }
  return tinted;
}

function strokeRect(surface, x, y, width, height, color, thickness) {
  for (let t = 0; t < thickness; t += 1) {
    for (let px = x + t; px < x + width - t; px += 1) {
      for (const py of [y + t, y + height - 1 - t]) {
        if (px < 0 || py < 0 || px >= surface.width || py >= surface.height) continue;
        const index = (py * surface.width + px) * 4;
        surface.data[index] = color[0];
        surface.data[index + 1] = color[1];
        surface.data[index + 2] = color[2];
        surface.data[index + 3] = 255;
      }
    }
    for (let py = y + t; py < y + height - t; py += 1) {
      for (const px of [x + t, x + width - 1 - t]) {
        if (px < 0 || py < 0 || px >= surface.width || py >= surface.height) continue;
        const index = (py * surface.width + px) * 4;
        surface.data[index] = color[0];
        surface.data[index + 1] = color[1];
        surface.data[index + 2] = color[2];
        surface.data[index + 3] = 255;
      }
    }
  }
}

function fillRectAlpha(surface, x, y, width, height, color, alpha) {
  for (let py = y; py < y + height; py += 1) {
    if (py < 0 || py >= surface.height) continue;
    for (let px = x; px < x + width; px += 1) {
      if (px < 0 || px >= surface.width) continue;
      const index = (py * surface.width + px) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        surface.data[index + channel] = Math.round(
          surface.data[index + channel] * (1 - alpha) + color[channel] * alpha,
        );
      }
      surface.data[index + 3] = 255;
    }
  }
}

const PLOT_CLEAR_COLOR = [88, 214, 122];
const PLOT_LOST_COLOR = [230, 58, 66];

/**
 * The walkability + plot-cost proof in one image: the blocked-cell tint plus
 * all 128 shelter plots outlined - green for clear, a filled red rect for
 * lost, so a viewer sees both facts at once.
 */
function paintShelterPlots(surface, plotReport) {
  const painted = createSurface(surface.width, surface.height);
  painted.data.set(surface.data);
  for (const status of plotReport.statuses) {
    const { tile } = status.plot;
    const x = tile.column * 32 + 16;
    const y = tile.row * 32 + 16;
    if (status.clear) {
      strokeRect(painted, x, y, 128, 128, PLOT_CLEAR_COLOR, 2);
    } else {
      fillRectAlpha(painted, x, y, 128, 128, PLOT_LOST_COLOR, 0.45);
      strokeRect(painted, x, y, 128, 128, PLOT_LOST_COLOR, 3);
    }
  }
  return painted;
}

// ---------------------------------------------------------------------------
// navigator routes over every boardwalk
// ---------------------------------------------------------------------------

const PATH_COLORS = [
  [255, 196, 60], [92, 224, 232], [244, 120, 200], [150, 230, 110], [255, 140, 90], [180, 160, 255],
];

function inlandEndpoint(scene, boardwalk, abutment, reach) {
  const nearestDeck = boardwalk.deck.reduce((best, candidate) => {
    const bestDistance = Math.hypot(best.column - abutment.column, best.row - abutment.row);
    const distance = Math.hypot(candidate.column - abutment.column, candidate.row - abutment.row);
    return distance < bestDistance ? candidate : best;
  });
  const stepColumn = Math.sign(abutment.column - nearestDeck.column);
  const stepRow = Math.sign(abutment.row - nearestDeck.row);
  let endpoint = abutment;
  for (let step = 1; step <= reach; step += 1) {
    const candidate = {
      column: abutment.column + stepColumn * step,
      row: abutment.row + stepRow * step,
    };
    if (candidate.column < 0 || candidate.row < 0) break;
    if (candidate.column >= scene.columns || candidate.row >= scene.rows) break;
    if (scene.collision[candidate.row * scene.columns + candidate.column] === 1) break;
    endpoint = candidate;
  }
  return endpoint;
}

function fillMarker(surface, centerX, centerY, half, color, alpha) {
  for (let y = centerY - half; y <= centerY + half; y += 1) {
    for (let x = centerX - half; x <= centerX + half; x += 1) {
      if (x < 0 || y < 0 || x >= surface.width || y >= surface.height) continue;
      const border = Math.abs(x - centerX) === half || Math.abs(y - centerY) === half;
      const rgb = border ? [18, 20, 22] : color;
      const index = (y * surface.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        surface.data[index + channel] = Math.round(
          surface.data[index + channel] * (1 - alpha) + rgb[channel] * alpha,
        );
      }
      surface.data[index + 3] = 255;
    }
  }
}

function ringMarker(surface, centerX, centerY, radius, color) {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (x < 0 || y < 0 || x >= surface.width || y >= surface.height) continue;
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance > radius || distance < radius - 2.2) continue;
      const index = (y * surface.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) surface.data[index + channel] = color[channel];
      surface.data[index + 3] = 255;
    }
  }
}

function paintNavigatorPaths(surface, scene, grid, findNavigationPath) {
  const painted = createSurface(surface.width, surface.height);
  painted.data.set(surface.data);
  const routes = [];
  scene.boardwalks.forEach((boardwalk, index) => {
    const start = inlandEndpoint(scene, boardwalk, boardwalk.abutments[0], 6);
    const goal = inlandEndpoint(scene, boardwalk, boardwalk.abutments[1], 6);
    const result = findNavigationPath(grid, { start, goal });
    const color = PATH_COLORS[index % PATH_COLORS.length];
    const deckKeys = new Set(boardwalk.deck.map((tile) => `${tile.column},${tile.row}`));
    let onDeck = 0;
    for (const tile of result.tiles) {
      const centerX = tile.column * scene.tileSize + scene.tileSize / 2;
      const centerY = tile.row * scene.tileSize + scene.tileSize / 2;
      const key = `${tile.column},${tile.row}`;
      if (deckKeys.has(key)) onDeck += 1;
      fillMarker(painted, centerX, centerY, deckKeys.has(key) ? 6 : 4, color, 0.92);
    }
    ringMarker(
      painted,
      start.column * scene.tileSize + scene.tileSize / 2,
      start.row * scene.tileSize + scene.tileSize / 2,
      11,
      color,
    );
    ringMarker(
      painted,
      goal.column * scene.tileSize + scene.tileSize / 2,
      goal.row * scene.tileSize + scene.tileSize / 2,
      11,
      [250, 250, 246],
    );
    routes.push({
      boardwalk: boardwalk.id,
      axis: boardwalk.axis,
      start,
      goal,
      status: result.status,
      steps: result.tiles.length,
      deckTilesOnPath: onDeck,
      deckTiles: boardwalk.deck.length,
    });
  });
  return { painted, routes };
}

// ---------------------------------------------------------------------------
// frame-vocabulary usage (the per-composition byte-share report)
// ---------------------------------------------------------------------------

function baseFrameId(material, variant) {
  return `t.${material}.${variant}`;
}
function edgeFrameId(material, mask, variant) {
  return `e.${material}.${mask}.${variant}`;
}
function shoreFrameId(material, mask, variant) {
  return `w.${material}.${mask}.${variant}`;
}

function collectUsedFrameIds(scene) {
  const ids = new Set();
  for (const tile of scene.tiles) {
    ids.add(baseFrameId(tile.base, tile.baseVariant));
    for (const overlay of tile.overlays) {
      ids.add(
        overlay.mask === 15
          ? baseFrameId(overlay.material, overlay.variant)
          : edgeFrameId(overlay.material, overlay.mask, overlay.variant),
      );
    }
    for (const shore of tile.shorelines) {
      ids.add(shoreFrameId(shore.material, shore.mask, shore.variant));
    }
  }
  for (const prop of scene.props) ids.add(prop.frameId);
  return ids;
}

/**
 * Estimate the byte share of the atlas a composition's actual vocabulary
 * subset represents: terrain frames are a uniform 32x32 grid, so a used-frame
 * COUNT ratio is an exact area proxy; scenery frames vary in size, so an
 * AREA ratio is used instead. This is an area-proportional ESTIMATE against
 * the whole PNG's indexed byte count, not a byte-exact re-encoding of the
 * subset - compression is not perfectly linear per frame - but it is a fair,
 * cheap "vocabulary price" for comparing compositions.
 */
function vocabularyReport(usedIds, manifest) {
  const terrainTotal = manifest.terrainGrid.ids.length;
  const usedTerrain = manifest.terrainGrid.ids.filter((id) => usedIds.has(id));
  const sceneryFrames = manifest.sceneryFrames;
  const sceneryTotalArea = sceneryFrames.reduce((sum, [, , , w, h]) => sum + w * h, 0);
  const usedScenery = sceneryFrames.filter(([id]) => usedIds.has(id));
  const usedSceneryArea = usedScenery.reduce((sum, [, , , w, h]) => sum + w * h, 0);

  const terrainBytes = manifest.images.terrain.bytes * (usedTerrain.length / terrainTotal);
  const sceneryBytes = manifest.images.scenery.bytes
    * (sceneryTotalArea > 0 ? usedSceneryArea / sceneryTotalArea : 0);
  const totalAtlasBytes = manifest.images.terrain.bytes + manifest.images.scenery.bytes;

  return {
    terrainFramesUsed: usedTerrain.length,
    terrainFramesTotal: terrainTotal,
    sceneryFramesUsed: usedScenery.length,
    sceneryFramesTotal: sceneryFrames.length,
    estimatedBytes: Math.round(terrainBytes + sceneryBytes),
    estimatedShareOfAtlas: (terrainBytes + sceneryBytes) / totalAtlasBytes,
    note: "area-proportional estimate, not a byte-exact re-encoding of the subset",
  };
}

// ---------------------------------------------------------------------------
// island-mask clipping (spring_terraces archetype, three elliptical lobes)
// ---------------------------------------------------------------------------

const ISLAND_LOBES = [
  { cx: 0, cy: -0.10, rx: 0.52, ry: 0.44 },
  { cx: -0.22, cy: 0.24, rx: 0.34, ry: 0.32 },
  { cx: 0.30, cy: 0.16, rx: 0.30, ry: 0.26 },
];

function insideIslandMask(nx, ny) {
  for (const lobe of ISLAND_LOBES) {
    const dx = (nx - lobe.cx) / lobe.rx;
    const dy = (ny - lobe.cy) / lobe.ry;
    if (dx * dx + dy * dy <= 1) return true;
  }
  return false;
}

function clipToIslandMask(surface) {
  const clipped = createSurface(surface.width, surface.height);
  for (let row = 0; row < surface.height; row += 1) {
    const ny = (row / surface.height) * 2 - 1;
    for (let column = 0; column < surface.width; column += 1) {
      const nx = (column / surface.width) * 2 - 1;
      const index = (row * surface.width + column) * 4;
      if (insideIslandMask(nx, ny)) {
        clipped.data[index] = surface.data[index];
        clipped.data[index + 1] = surface.data[index + 1];
        clipped.data[index + 2] = surface.data[index + 2];
        clipped.data[index + 3] = surface.data[index + 3];
      }
      // else: fully transparent (outside the island silhouette).
    }
  }
  return clipped;
}

/** Paste `source` onto `dest` at (x, y), source-over. */
function paste(dest, source, x, y) {
  for (let row = 0; row < source.height; row += 1) {
    const targetY = y + row;
    if (targetY < 0 || targetY >= dest.height) continue;
    for (let column = 0; column < source.width; column += 1) {
      const targetX = x + column;
      if (targetX < 0 || targetX >= dest.width) continue;
      const sourceIndex = (row * source.width + column) * 4;
      const alpha = source.data[sourceIndex + 3] / 255;
      if (alpha <= 0) continue;
      const targetIndex = (targetY * dest.width + targetX) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        dest.data[targetIndex + channel] = Math.round(
          source.data[sourceIndex + channel] * alpha
            + dest.data[targetIndex + channel] * (1 - alpha),
        );
      }
      dest.data[targetIndex + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------------------
// per-composition characteristic detail crop
// ---------------------------------------------------------------------------

const DETAIL_CROPS = {
  "a-sinter-rim": { x: 0, y: 0 }, // the NW horseshoe corner + a vent + a boardwalk
  "b-great-terrace": { x: 0, y: 0 }, // the great terrace mass reaching the district
  "c-rift": { x: 512, y: 1024 }, // the rift crossing districts, boardwalks + fissures
};

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

export async function renderWarmSpringsPilot(outputRoot = DEFAULT_OUTPUT) {
  const server = await createServer({
    root: FRONTEND_ROOT,
    configFile: path.join(FRONTEND_ROOT, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "warn",
  });
  try {
    const sceneModule = await server.ssrLoadModule("/src/qa/warmSpringsPilot/springsScene.ts");
    const painterModule = await server.ssrLoadModule("/src/qa/warmSpringsPilot/springsPainter.ts");
    const walkabilityModule = await server.ssrLoadModule("/src/qa/warmSpringsPilot/springsWalkability.ts");
    const navigationModule = await server.ssrLoadModule(
      "/src/renderer2d/production/navigation/navigation.ts",
    );

    const assetRoot = path.join(FRONTEND_ROOT, "src/qa/warmSpringsPilot/assets");
    const manifest = JSON.parse(await readFile(path.join(assetRoot, "atlas.json"), "utf8"));
    const terrain = await loadSurface(path.join(assetRoot, "terrain.png"));
    const scenery = await loadSurface(path.join(assetRoot, "scenery.png"));

    await mkdir(outputRoot, { recursive: true });

    const results = {};
    const thumbnails = {};

    for (const compositionId of sceneModule.WARM_SPRINGS_COMPOSITION_IDS) {
      const scene = sceneModule.createWarmSpringsScene(compositionId);
      const plan = painterModule.createSpringsPaintPlan(scene, manifest);

      const surface = createSurface(scene.widthPixels, scene.heightPixels);
      const context = createContext(surface);
      painterModule.renderSpringsPlan(context, plan, { terrain, scenery });

      const plotReport = walkabilityModule.shelterPlotReport(scene);
      const springReport = walkabilityModule.springVisibilityReport(scene);
      const grid = walkabilityModule.toNavigationGrid(scene);
      const components = sceneModule.walkableComponents(scene.collision, scene.columns, scene.rows);

      const walkableSurface = paintShelterPlots(tintBlockedCells(surface, scene), plotReport);
      const { painted: routesSurface, routes } = paintNavigatorPaths(
        surface, scene, grid, navigationModule.findNavigationPath,
      );
      const crop = DETAIL_CROPS[compositionId];
      const detailSurface = cropSurface(surface, crop.x, crop.y, 1536, 1024);

      const wrote = {
        main: await writePng(surface, path.join(outputRoot, `${compositionId}.png`)),
        walkable: await writePng(walkableSurface, path.join(outputRoot, `${compositionId}-walkable.png`)),
        detail: await writePng(detailSurface, path.join(outputRoot, `${compositionId}-detail.png`)),
        routes: await writePng(routesSurface, path.join(outputRoot, `${compositionId}-routes.png`)),
      };

      const usedIds = collectUsedFrameIds(scene);
      const vocabulary = vocabularyReport(usedIds, manifest);

      let mineralTiles = 0;
      for (const tile of scene.tiles) if (MINERAL_MATERIALS.has(tile.material)) mineralTiles += 1;

      const blockedTiles = scene.collision.reduce((total, cell) => total + cell, 0);

      results[compositionId] = {
        compositionId,
        widthPixels: scene.widthPixels,
        heightPixels: scene.heightPixels,
        totalTiles: scene.tiles.length,
        walkableTiles: scene.tiles.length - blockedTiles,
        blockedTiles,
        mineralTiles,
        mineralSharePct: Number((100 * mineralTiles / scene.tiles.length).toFixed(1)),
        componentCount: components.length,
        componentSizes: components.map((component) => component.tiles.length),
        plotsClear: plotReport.clear,
        plotsLost: plotReport.lost,
        plotsTotal: plotReport.total,
        lostPlotIds: plotReport.statuses.filter((s) => !s.clear).map((s) => s.plot.id),
        plotsWithSpringInView: springReport.plotsWithSpringInView,
        springMedianDistance: springReport.medianDistance,
        springMaxDistance: springReport.maxDistance,
        boardwalkCount: scene.boardwalks.length,
        boardwalks: routes,
        drawOperations: plan.operations.length,
        propCount: scene.props.length,
        vocabulary,
        wrote,
      };

      thumbnails[compositionId] = surface;
    }

    // Map-scale legibility strip: each composition raw + island-clipped, at
    // ~64px and ~140px wide, beside the shipped Nirvana region.
    let nirvanaSurface = null;
    try {
      nirvanaSurface = await loadSurface(NIRVANA_WORLD_MAP);
    } catch {
      nirvanaSurface = null;
    }

    const sizes = [64, 140];
    const cellPad = 6;
    const cellSize = Math.max(...sizes) + cellPad * 2;
    const columnsOrder = ["a-sinter-rim", "b-great-terrace", "c-rift", "nirvana"];
    const rowsOrder = ["raw-64", "clipped-64", "raw-140", "clipped-140"];
    const stripWidth = cellSize * columnsOrder.length;
    const stripHeight = cellSize * rowsOrder.length;
    const strip = createSurface(stripWidth, stripHeight);
    // Neutral dark backdrop so a transparent (clipped) thumbnail reads clearly.
    for (let index = 0; index < strip.data.length; index += 4) {
      strip.data[index] = 14;
      strip.data[index + 1] = 18;
      strip.data[index + 2] = 15;
      strip.data[index + 3] = 255;
    }

    for (const [columnIndex, id] of columnsOrder.entries()) {
      const source = id === "nirvana" ? nirvanaSurface : thumbnails[id];
      if (source === null || source === undefined) continue;
      for (const [rowIndex, spec] of rowsOrder.entries()) {
        const clipped = spec.startsWith("clipped");
        const size = spec.endsWith("140") ? 140 : 64;
        const prepared = clipped ? clipToIslandMask(source) : source;
        const thumb = downsample(prepared, size);
        const x = columnIndex * cellSize + Math.round((cellSize - thumb.width) / 2);
        const y = rowIndex * cellSize + Math.round((cellSize - thumb.height) / 2);
        paste(strip, thumb, x, y);
      }
    }
    const mapScaleBytes = await writePng(strip, path.join(outputRoot, "map-scale.png"));

    const summary = {
      outputRoot,
      atlasBudget: {
        terrainBytes: manifest.images.terrain.bytes,
        sceneryBytes: manifest.images.scenery.bytes,
        note: "atlas.json's own byte count is not repeated here; see the authoring script's report",
      },
      mapScale: {
        file: path.join(outputRoot, "map-scale.png"),
        bytes: mapScaleBytes,
        layout: {
          columns: columnsOrder,
          rows: rowsOrder,
          note: "grid, left-to-right = columns above, top-to-bottom = rows above; "
            + "nirvana column uses the shipped world-map PNG, not a re-render",
        },
      },
      compositions: results,
    };

    await writeFile(
      path.join(outputRoot, "summary.json"),
      JSON.stringify(summary, null, 1),
    );

    return summary;
  } finally {
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf("--out");
  const outputRoot = outIndex > 0 ? path.resolve(process.argv[outIndex + 1]) : DEFAULT_OUTPUT;
  renderWarmSpringsPilot(outputRoot)
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 1)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
