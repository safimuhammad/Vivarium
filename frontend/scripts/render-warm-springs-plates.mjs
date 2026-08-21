/**
 * Renders the three Warm Springs PILOT compositions to native-scale plates.
 *
 * Same discipline as `render-nirvana-valley-pilot.mjs`: the scene, the frame
 * vocabulary and the paint plan all come from the pilot's TypeScript modules
 * loaded through Vite's SSR loader, and the plan is executed by the PRODUCTION
 * `drawProductionStaticSceneOperation`. The only thing this script supplies is a
 * raw-RGBA `drawImage` backend, because Node has no canvas.
 *
 * Per composition, at 3072x3072 (the full canonical region):
 *   <id>.png           the terrain as the real painter draws it
 *   <id>-walkable.png  blocked cells tinted + all 128 shelter plots outlined,
 *                      green = buildable, red = lost. Plot cost, visible.
 *   <id>-detail.png    a 1536x1024 1:1 crop -- the same size as the approved
 *                      Nirvana plates, so surface quality is judged like for like
 *   <id>-routes.png    the REAL findNavigationPath route across every boardwalk
 * Plus map-scale.png: every composition shrunk to island size, raw and clipped
 * by the region's island silhouette, beside the shipped Nirvana.
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

const PILOT = "/src/qa/warmSpringsPilot";
const ASSET_ROOT = path.join(FRONTEND_ROOT, "src/qa/warmSpringsPilot/assets");

/** Where each composition's 1536x1024 detail crop is taken from (tile coords). */
const DETAIL_ORIGIN = {
  "a-sinter-rim": { column: 0, row: 26 },
  "b-great-terrace": { column: 2, row: 2 },
  "c-rift": { column: 20, row: 36 },
};

// ---------------------------------------------------------------------------
// raw RGBA surface + the minimal 2D context the production draw op needs
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

/** Every boardwalk crossed by the REAL navigator, drawn tile by tile. */
function routePlate(base, scene, grid, findNavigationPath) {
  const surface = copySurface(base);
  const palette = [
    [255, 214, 92], [126, 214, 255], [255, 138, 196],
    [154, 255, 154], [255, 176, 96], [188, 156, 255],
  ];
  const routes = [];
  scene.boardwalks.forEach((boardwalk, index) => {
    const colour = palette[index % palette.length];
    const deck = boardwalk.deck;
    const first = deck[0];
    const last = deck[deck.length - 1];
    const reach = 6;
    const start = boardwalk.axis === "east-west"
      ? { column: Math.max(0, first.column - reach), row: first.row }
      : { column: first.column, row: Math.max(0, first.row - reach) };
    const goal = boardwalk.axis === "east-west"
      ? { column: Math.min(scene.columns - 1, last.column + reach), row: last.row }
      : { column: last.column, row: Math.min(scene.rows - 1, last.row + reach) };
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
      boardwalk: boardwalk.id,
      axis: boardwalk.axis,
      status: result.status,
      steps: (result.tiles ?? []).length,
      deckTiles: deck.length,
      deckTilesOnPath: onDeck,
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

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

export async function renderWarmSpringsPlates(outputRoot = DEFAULT_OUTPUT) {
  const server = await createServer({
    root: FRONTEND_ROOT,
    configFile: path.join(FRONTEND_ROOT, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "warn",
  });
  try {
    const sceneModule = await server.ssrLoadModule(`${PILOT}/springsScene.ts`);
    const painterModule = await server.ssrLoadModule(`${PILOT}/springsPainter.ts`);
    const walkModule = await server.ssrLoadModule(`${PILOT}/springsWalkability.ts`);
    const navigationModule = await server.ssrLoadModule(
      "/src/renderer2d/production/navigation/navigation.ts",
    );

    const manifest = JSON.parse(await readFile(path.join(ASSET_ROOT, "atlas.json"), "utf8"));
    const terrain = await loadSurface(path.join(ASSET_ROOT, "terrain.png"));
    const scenery = await loadSurface(path.join(ASSET_ROOT, "scenery.png"));
    await mkdir(outputRoot, { recursive: true });

    const summaries = [];
    for (const id of sceneModule.WARM_SPRINGS_COMPOSITION_IDS) {
      const scene = sceneModule.createWarmSpringsScene(id);
      const plan = painterModule.createSpringsPaintPlan(scene, manifest);
      const surface = createSurface(scene.widthPixels, scene.heightPixels);
      painterModule.renderSpringsPlan(createContext(surface), plan, { terrain, scenery });

      const plots = walkModule.shelterPlotReport(scene);
      const visibility = walkModule.springVisibilityReport(scene);
      const grid = walkModule.toNavigationGrid(scene);
      const components = sceneModule.walkableComponents(
        scene.collision, scene.columns, scene.rows,
      );

      const walk = walkabilityPlate(surface, scene, plots);
      const route = routePlate(surface, scene, grid, navigationModule.findNavigationPath);
      const origin = DETAIL_ORIGIN[id] ?? { column: 0, row: 0 };
      const detail = cropSurface(
        surface, origin.column * scene.tileSize, origin.row * scene.tileSize, 1536, 1024,
      );

      const wrote = {
        plate: await writePng(surface, path.join(outputRoot, `${id}.png`)),
        walkable: await writePng(walk.surface, path.join(outputRoot, `${id}-walkable.png`)),
        mask: await writePng(bareMask(scene), path.join(outputRoot, `${id}-mask.png`)),
        detail: await writePng(detail, path.join(outputRoot, `${id}-detail.png`)),
        routes: await writePng(route.surface, path.join(outputRoot, `${id}-routes.png`)),
      };

      const blocked = scene.collision.reduce((total, cell) => total + cell, 0);
      summaries.push({
        composition: id,
        walkable: scene.collision.length - blocked,
        blocked,
        components: components.length,
        plotsClear: plots.clear,
        plotsLost: plots.lost,
        plotsWithSpringInView: visibility.plotsWithSpringInView,
        medianDistance: visibility.medianDistance,
        maxDistance: visibility.maxDistance,
        drawOperations: plan.operations.length,
        props: scene.props.length,
        boardwalks: route.routes,
        wrote,
      });
      process.stdout.write(`rendered ${id}\n`);
    }
    return { outputRoot, summaries };
  } finally {
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf("--out");
  renderWarmSpringsPlates(outIndex > 0 ? path.resolve(process.argv[outIndex + 1]) : DEFAULT_OUTPUT)
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 1)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
