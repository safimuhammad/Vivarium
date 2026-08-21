/**
 * Renders the three Nirvana East PILOT compositions to native-scale plates.
 *
 * Sibling of `render-warm-springs-plates.mjs`: same discipline. The scene,
 * frame vocabulary and paint plan all come from the pilot's TypeScript
 * modules loaded through Vite's SSR loader, and the plan is executed by the
 * PRODUCTION `drawProductionStaticSceneOperation`. The only thing this
 * script supplies is a raw-RGBA `drawImage` backend, because Node has no
 * canvas.
 *
 * Per composition, at 3072x3072 (the full canonical region):
 *   <id>.png            the terrain as the real painter draws it
 *   <id>-walkable.png   blocked cells tinted + all 128 shelter plots
 *                        outlined, green = buildable, red = lost
 *   <id>-mask.png        the bare walkability mask
 *   <id>-detail.png      a 1536x1024 1:1 crop, same size as the approved
 *                        Nirvana/Warm Springs plates
 *   <id>-routes.png      the REAL findNavigationPath route across every
 *                        crossing, both axes
 *   <id>-wrap.png         THE NEW ONE: the region tiled 2x2, downscaled to a
 *                        viewable size, with the two internal seams marked
 *                        — the visual proof the terrain wraps on a torus
 *   <id>-wrap-detail.png a 1:1 seam strip pair (vertical seam, horizontal
 *                        seam) so the join can be judged at native resolution
 *
 * `map-scale.png` is NOT produced here — see `render-nirvana-east-map-scale.mjs`
 * (this sibling, unlike `render-warm-springs-pilot.mjs`, does not fold it in,
 * matching how `render-warm-springs-plates.mjs` itself is plates-only).
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
  "docs/frontend/mockups/regions/nirvana-east-pilot",
);

const PILOT = "/src/qa/nirvanaEastPilot";
const ASSET_ROOT = path.join(FRONTEND_ROOT, "src/qa/nirvanaEastPilot/assets");

const REGION_TILES = 96;
const TILE_SIZE = 32;
const REGION_PX = REGION_TILES * TILE_SIZE; // 3072

/** Where each composition's 1536x1024 detail crop is taken from (tile coords). */
const DETAIL_ORIGIN = {
  // Frames the first full district cell (origin 18,18) plus its connecting sand
  // corridor, so the crop is honest evidence of the composition's actual
  // structure (see the report: A reads as a cut-bank-ringed box per district,
  // not a single meandering braided network).
  "a-arroyo-braid": { column: 8, row: 8 },
  "b-mesa-field": { column: 30, row: 30 },
  // Framed to include the brine channel (crossings c-ns-brine-20 / c-ew-brine-20
  // sit near column/row 20) alongside a band boundary.
  "c-salt-pan": { column: 2, row: 26 },
};

/**
 * Where each composition's wrap seam strips are centred, in TILE coords —
 * chosen to fall on content near the seam rather than empty ground so the
 * continuity check actually has something to look at. Tuned after the first
 * visual pass; see the report for the by-eye verdict.
 */
const SEAM_FOCUS = {
  "a-arroyo-braid": { verticalRow: 48, horizontalColumn: 48 },
  "b-mesa-field": { verticalRow: 48, horizontalColumn: 48 },
  "c-salt-pan": { verticalRow: 48, horizontalColumn: 48 },
};

// ---------------------------------------------------------------------------
// raw RGBA surface + the minimal 2D context the production draw op needs
// (identical to render-warm-springs-plates.mjs)
// ---------------------------------------------------------------------------

function createSurface(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

async function loadSurface(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw()
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
  const png = await sharp(
    Buffer.from(surface.data.buffer, surface.data.byteOffset, surface.data.length),
    { raw: { width: surface.width, height: surface.height, channels: 4 } },
  ).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(file, png);
  return png.length;
}

function copySurface(surface) {
  const copy = createSurface(surface.width, surface.height);
  copy.data.set(surface.data);
  return copy;
}

function blend(surface, x, y, colour, alpha) {
  if (x < 0 || y < 0 || x >= surface.width || y >= surface.height) return;
  const index = (y * surface.width + x) * 4;
  for (let channel = 0; channel < 3; channel += 1) {
    surface.data[index + channel] = Math.round(
      colour[channel] * alpha + surface.data[index + channel] * (1 - alpha),
    );
  }
  surface.data[index + 3] = 255;
}

function strokeRect(surface, x, y, width, height, colour, thickness = 2) {
  for (let t = 0; t < thickness; t += 1) {
    for (let column = x; column < x + width; column += 1) {
      blend(surface, column, y + t, colour, 1);
      blend(surface, column, y + height - 1 - t, colour, 1);
    }
    for (let row = y; row < y + height; row += 1) {
      blend(surface, x + t, row, colour, 1);
      blend(surface, x + width - 1 - t, row, colour, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// overlays
// ---------------------------------------------------------------------------

/** Blocked ground tinted red, plus every shelter plot outlined by its verdict. */
function walkabilityPlate(base, scene, plots) {
  const surface = copySurface(base);
  const { collision, columns, rows, tileSize } = scene;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (collision[row * columns + column] !== 1) continue;
      for (let y = 0; y < tileSize; y += 1) {
        for (let x = 0; x < tileSize; x += 1) {
          blend(surface, column * tileSize + x, row * tileSize + y, [226, 62, 54], 0.42);
        }
      }
    }
  }
  let lost = 0;
  for (const status of plots.statuses) {
    const { column, row } = status.plot.tile;
    // The real 128x128 shelter render rect starts at the plot tile's CENTRE.
    const x = column * tileSize + tileSize / 2;
    const y = row * tileSize + tileSize / 2;
    const colour = status.clear ? [104, 232, 128] : [255, 72, 60];
    strokeRect(surface, x, y, 128, 128, colour, status.clear ? 2 : 4);
    if (!status.clear) lost += 1;
  }
  return { surface, lost };
}

function bareMask(scene) {
  const surface = createSurface(scene.widthPixels, scene.heightPixels);
  const { collision, columns, rows, tileSize } = scene;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const blocked = collision[row * columns + column] === 1;
      const colour = blocked ? [22, 24, 28] : [232, 236, 230];
      for (let y = 0; y < tileSize; y += 1) {
        for (let x = 0; x < tileSize; x += 1) {
          const index = ((row * tileSize + y) * surface.width + column * tileSize + x) * 4;
          surface.data[index] = colour[0];
          surface.data[index + 1] = colour[1];
          surface.data[index + 2] = colour[2];
          surface.data[index + 3] = 255;
        }
      }
    }
  }
  return surface;
}

function fillMarker(surface, centreX, centreY, radius, colour, alpha) {
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (x * x + y * y > radius * radius) continue;
      blend(surface, centreX + x, centreY + y, colour, alpha);
    }
  }
}

/**
 * Walk outward from an abutment tile, AWAY from the deck's nearest tile,
 * using the scene's REAL collision data, stopping at the first blocked tile
 * (or the region edge). Returns the deepest confirmed-walkable tile within
 * `reach` steps -- never a tile picked by assuming a straight line stays
 * clear, which is what produced a false "unreachable" the first time this
 * script used a naive fixed-offset endpoint (see the report). Mirrors
 * `render-warm-springs-pilot.mjs`'s `inlandEndpoint`.
 */
function inlandEndpoint(scene, crossing, abutment, reach) {
  const nearestDeck = crossing.deck.reduce((best, candidate) => {
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

/**
 * Every crossing traversed by the REAL navigator, drawn tile by tile. A
 * composition with NO crossings (a legitimate outcome -- see the report) is
 * handled gracefully: the plate is still written, just with no route paint.
 */
function routePlate(base, scene, grid, findNavigationPath) {
  const surface = copySurface(base);
  const palette = [
    [255, 214, 92], [126, 214, 255], [255, 138, 196],
    [154, 255, 154], [255, 176, 96], [188, 156, 255],
  ];
  const routes = [];
  scene.crossings.forEach((crossing, index) => {
    const colour = palette[index % palette.length];
    const deck = crossing.deck;
    const [firstAbutment, secondAbutment] = crossing.abutments;
    const start = inlandEndpoint(scene, crossing, firstAbutment, 8);
    const goal = inlandEndpoint(scene, crossing, secondAbutment ?? firstAbutment, 8);
    const result = findNavigationPath(grid, { start, goal });
    const deckKeys = new Set(deck.map((tile) => `${tile.column},${tile.row}`));
    let onDeck = 0;
    for (const tile of result.tiles ?? []) {
      const key = `${tile.column},${tile.row}`;
      if (deckKeys.has(key)) onDeck += 1;
      fillMarker(
        surface,
        tile.column * scene.tileSize + scene.tileSize / 2,
        tile.row * scene.tileSize + scene.tileSize / 2,
        deckKeys.has(key) ? 9 : 6,
        colour,
        0.95,
      );
    }
    routes.push({
      crossing: crossing.id,
      axis: crossing.axis,
      status: result.status,
      steps: (result.tiles ?? []).length,
      deckTiles: deck.length,
      deckTilesOnPath: onDeck,
      start,
      goal,
    });
  });
  return { surface, routes };
}

function cropSurface(surface, x, y, width, height) {
  const out = createSurface(width, height);
  for (let row = 0; row < height; row += 1) {
    const sourceRow = y + row;
    if (sourceRow < 0 || sourceRow >= surface.height) continue;
    for (let column = 0; column < width; column += 1) {
      const sourceColumn = x + column;
      if (sourceColumn < 0 || sourceColumn >= surface.width) continue;
      const source = (sourceRow * surface.width + sourceColumn) * 4;
      const target = (row * width + column) * 4;
      out.data[target] = surface.data[source];
      out.data[target + 1] = surface.data[source + 1];
      out.data[target + 2] = surface.data[source + 2];
      out.data[target + 3] = surface.data[source + 3];
    }
  }
  return out;
}

/** Nearest/box-average downsample -- good enough for a legibility thumbnail. */
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

/** Paste `source` onto `dest` at (x, y), 1:1, opaque. */
function paste(dest, source, x, y) {
  for (let row = 0; row < source.height; row += 1) {
    const targetY = y + row;
    if (targetY < 0 || targetY >= dest.height) continue;
    for (let column = 0; column < source.width; column += 1) {
      const targetX = x + column;
      if (targetX < 0 || targetX >= dest.width) continue;
      const sourceIndex = (row * source.width + column) * 4;
      const targetIndex = (targetY * dest.width + targetX) * 4;
      dest.data[targetIndex] = source.data[sourceIndex];
      dest.data[targetIndex + 1] = source.data[sourceIndex + 1];
      dest.data[targetIndex + 2] = source.data[sourceIndex + 2];
      dest.data[targetIndex + 3] = 255;
    }
  }
}

/**
 * The 2x2 wrap plate: the SAME 3072x3072 plate repeated in a 2x2 arrangement
 * (6144x6144), downscaled to ~2048x2048, with the two internal seams marked
 * by thin semi-transparent guide lines. This is the visual proof the region
 * wraps on a torus -- a viewer looks along either line and judges whether
 * material and features continue.
 */
function buildWrapPlate(plate) {
  const tiled = createSurface(plate.width * 2, plate.height * 2);
  paste(tiled, plate, 0, 0);
  paste(tiled, plate, plate.width, 0);
  paste(tiled, plate, 0, plate.height);
  paste(tiled, plate, plate.width, plate.height);
  const targetWidth = 2048;
  const shrunk = downsample(tiled, targetWidth);
  const seamX = Math.round((plate.width / tiled.width) * shrunk.width);
  const seamY = Math.round((plate.height / tiled.height) * shrunk.height);
  const guideColour = [90, 240, 255];
  for (let offset = -1; offset <= 1; offset += 1) {
    for (let y = 0; y < shrunk.height; y += 1) blend(shrunk, seamX + offset, y, guideColour, 0.55);
    for (let x = 0; x < shrunk.width; x += 1) blend(shrunk, x, seamY + offset, guideColour, 0.55);
  }
  return shrunk;
}

/** A 1536x512 1:1 crop of the 2x2-tiled surface, centred on a seam. */
function seamStrip(tiled, centreX, centreY) {
  return cropSurface(tiled, centreX - 768, centreY - 256, 1536, 512);
}

function labelSvg(width, height, text) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return Buffer.from(
    `<svg width="${width}" height="${height}">`
    + `<rect width="${width}" height="${height}" fill="#101214"/>`
    + `<text x="12" y="${Math.round(height / 2) + 5}" font-family="Helvetica,Arial,sans-serif" `
    + `font-size="15" fill="#e6e2d8">${escaped}</text></svg>`,
  );
}

const LABEL_HEIGHT = 34;

/** Write a raw surface plus a text caption band beneath it, via sharp composite. */
async function writePngWithCaption(surface, caption, file) {
  const buffer = Buffer.from(
    surface.data.buffer, surface.data.byteOffset, surface.data.length,
  );
  const panel = await sharp(buffer, {
    raw: { width: surface.width, height: surface.height, channels: 4 },
  }).png().toBuffer();
  const png = await sharp({
    create: {
      width: surface.width,
      height: surface.height + LABEL_HEIGHT,
      channels: 4,
      background: { r: 16, g: 18, b: 20, alpha: 1 },
    },
  }).composite([
    { input: panel, left: 0, top: 0 },
    { input: labelSvg(surface.width, LABEL_HEIGHT, caption), left: 0, top: surface.height },
  ]).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(file, png);
  return png.length;
}

/** Stack two labelled panels vertically -- the seam-strip pair file. */
async function writeStackedPanels(panels, file) {
  const width = Math.max(...panels.map((panel) => panel.surface.width));
  let height = 0;
  const composite = [];
  for (const panel of panels) {
    composite.push({ input: labelSvg(width, LABEL_HEIGHT, panel.caption), left: 0, top: height });
    height += LABEL_HEIGHT;
    const buffer = Buffer.from(
      panel.surface.data.buffer, panel.surface.data.byteOffset, panel.surface.data.length,
    );
    const panelPng = await sharp(buffer, {
      raw: { width: panel.surface.width, height: panel.surface.height, channels: 4 },
    }).png().toBuffer();
    composite.push({ input: panelPng, left: 0, top: height });
    height += panel.surface.height + 8;
  }
  const png = await sharp({
    create: { width, height, channels: 4, background: { r: 16, g: 18, b: 20, alpha: 1 } },
  }).composite(composite).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(file, png);
  return png.length;
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

export async function renderNirvanaEastPlates(outputRoot = DEFAULT_OUTPUT) {
  const server = await createServer({
    root: FRONTEND_ROOT,
    configFile: path.join(FRONTEND_ROOT, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "warn",
  });
  try {
    const sceneModule = await server.ssrLoadModule(`${PILOT}/eastScene.ts`);
    const painterModule = await server.ssrLoadModule(`${PILOT}/eastPainter.ts`);
    const walkModule = await server.ssrLoadModule(`${PILOT}/eastWalkability.ts`);
    const navigationModule = await server.ssrLoadModule(
      "/src/renderer2d/production/navigation/navigation.ts",
    );

    const manifest = JSON.parse(await readFile(path.join(ASSET_ROOT, "atlas.json"), "utf8"));
    const terrain = await loadSurface(path.join(ASSET_ROOT, "terrain.png"));
    const scenery = await loadSurface(path.join(ASSET_ROOT, "scenery.png"));
    await mkdir(outputRoot, { recursive: true });

    const summaries = [];
    for (const id of sceneModule.NIRVANA_EAST_COMPOSITION_IDS) {
      const scene = sceneModule.createNirvanaEastScene(id);
      const plan = painterModule.createEastPaintPlan(scene, manifest);
      const surface = createSurface(scene.widthPixels, scene.heightPixels);
      painterModule.renderEastPlan(createContext(surface), plan, { terrain, scenery });

      const plots = walkModule.shelterPlotReport(scene);
      const visibility = walkModule.identityVisibilityReport(scene);
      const grid = walkModule.toNavigationGrid(scene);
      const torus = walkModule.torusReport(scene);
      const landmarkSites = walkModule.landmarkAnchorSites(scene);
      const seamMismatches = sceneModule.cornerSeamMismatches(scene);
      const components = sceneModule.walkableComponents(
        scene.collision, scene.columns, scene.rows, true,
      );

      const walk = walkabilityPlate(surface, scene, plots);
      const route = routePlate(surface, scene, grid, navigationModule.findNavigationPath);
      const origin = DETAIL_ORIGIN[id] ?? { column: 0, row: 0 };
      const detail = cropSurface(
        surface, origin.column * scene.tileSize, origin.row * scene.tileSize, 1536, 1024,
      );

      // --- the wrap plate + seam strips -------------------------------
      const tiled = createSurface(surface.width * 2, surface.height * 2);
      paste(tiled, surface, 0, 0);
      paste(tiled, surface, surface.width, 0);
      paste(tiled, surface, 0, surface.height);
      paste(tiled, surface, surface.width, surface.height);
      const wrapImage = buildWrapPlate(surface);
      const focus = SEAM_FOCUS[id] ?? { verticalRow: 48, horizontalColumn: 48 };
      const verticalStrip = seamStrip(
        tiled, surface.width, focus.verticalRow * scene.tileSize,
      );
      const horizontalStrip = seamStrip(
        tiled, focus.horizontalColumn * scene.tileSize, surface.height,
      );

      const wrote = {
        plate: await writePng(surface, path.join(outputRoot, `${id}.png`)),
        walkable: await writePng(walk.surface, path.join(outputRoot, `${id}-walkable.png`)),
        mask: await writePng(bareMask(scene), path.join(outputRoot, `${id}-mask.png`)),
        detail: await writePng(detail, path.join(outputRoot, `${id}-detail.png`)),
        routes: await writePngWithCaption(
          route.surface,
          scene.crossings.length === 0
            ? `${id} — no crossing required — one undivided walkable component (${components.length} component${components.length === 1 ? "" : "s"})`
            : `${id} — ${scene.crossings.length} crossings — `
              + `${route.routes.filter((entry) => entry.status === "reached").length}/${route.routes.length} reached`,
          path.join(outputRoot, `${id}-routes.png`),
        ),
        wrap: await writePngWithCaption(
          wrapImage,
          `${id} — 2x2 torus wrap — seam mismatch NS/EW ${torus.seamMismatchNS}/${torus.seamMismatchEW}`
          + ` — wrap openings NS/EW ${torus.wrapOpeningsNS}/${torus.wrapOpeningsEW}`,
          path.join(outputRoot, `${id}-wrap.png`),
        ),
        wrapDetail: await writeStackedPanels(
          [
            { surface: verticalStrip, caption: `${id} — vertical seam (east|west join), row ${focus.verticalRow}` },
            { surface: horizontalStrip, caption: `${id} — horizontal seam (north|south join), column ${focus.horizontalColumn}` },
          ],
          path.join(outputRoot, `${id}-wrap-detail.png`),
        ),
      };

      const blocked = scene.collision.reduce((total, cell) => total + cell, 0);
      const summary = {
        composition: id,
        walkable: scene.collision.length - blocked,
        blocked,
        blockedPct: Number((100 * blocked / scene.collision.length).toFixed(2)),
        components: components.length,
        componentSizes: components.map((component) => component.tiles?.length ?? component.length),
        plotsClear: plots.clear,
        plotsLost: plots.lost,
        plotsWithIdentityInView: visibility.plotsWithIdentityInView,
        medianDistance: visibility.medianDistance,
        maxDistance: visibility.maxDistance,
        drawOperations: plan.operations.length,
        props: scene.props.length,
        crossings: route.routes,
        cornerSeamMismatches: seamMismatches,
        torus,
        landmarkAnchorSites: Array.isArray(landmarkSites) ? landmarkSites.length : landmarkSites,
        wrote,
      };
      summaries.push(summary);
      process.stdout.write(`rendered ${id}\n`);
      process.stdout.write(`${JSON.stringify(summary, null, 1)}\n`);
    }
    return {
      outputRoot,
      atlasBytes: {
        terrain: (await sharp(path.join(ASSET_ROOT, "terrain.png")).toBuffer()).length,
        scenery: (await sharp(path.join(ASSET_ROOT, "scenery.png")).toBuffer()).length,
      },
      summaries,
    };
  } finally {
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf("--out");
  renderNirvanaEastPlates(outIndex > 0 ? path.resolve(process.argv[outIndex + 1]) : DEFAULT_OUTPUT)
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 1)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
