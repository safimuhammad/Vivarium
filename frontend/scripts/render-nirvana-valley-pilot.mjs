/**
 * Renders the Nirvana river-valley PILOT to native-scale PNGs.
 *
 * The scene, the frame vocabulary, and the paint plan all come from the pilot's
 * TypeScript modules, loaded through Vite's SSR loader, and the plan is executed
 * by the PRODUCTION `drawProductionStaticSceneOperation`. The only thing this
 * script supplies is a raw-RGBA `drawImage` backend, because Node has no canvas:
 * integer source rect, integer destination, no smoothing, source-over - exactly
 * what the browser does for these operations.
 *
 * Emits, at 1536x1024 (one production Nirvana chunk, and the same size as the
 * approved reference plate):
 *   valley.png            the terrain as the real painter draws it
 *   valley-walkable.png   the same view with every blocked cell tinted
 *   valley-mask.png       the bare walkability mask
 *   valley-path.png       the REAL navigator's route over each bridge, drawn
 *                         tile by tile on the art
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { createServer } from "vite";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");
const REPO_ROOT = path.resolve(FRONTEND_ROOT, "..");
const DEFAULT_OUTPUT = path.resolve(
  REPO_ROOT,
  "docs/frontend/mockups/regions/nirvana-pilot",
);

// ---------------------------------------------------------------------------
// raw RGBA surface + the minimal 2D context the production draw op needs
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

/**
 * `drawImage` with the 9-argument signature, source-over, nearest, no scaling
 * beyond an integer 1:1 copy. This is the whole canvas surface area the
 * production draw operation touches.
 */
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
          tinted.data[index] = Math.round(
            tinted.data[index] * (1 - strength) + 226 * strength,
          );
          tinted.data[index + 1] = Math.round(
            tinted.data[index + 1] * (1 - strength) + 44 * strength,
          );
          tinted.data[index + 2] = Math.round(
            tinted.data[index + 2] * (1 - strength) + 62 * strength,
          );
          tinted.data[index + 3] = 255;
        }
      }
    }
  }
  return tinted;
}

function bareMask(scene) {
  const { collision, columns, rows, tileSize } = scene;
  const surface = createSurface(columns * tileSize, rows * tileSize);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const blocked = collision[row * columns + column] === 1;
      for (let y = 0; y < tileSize; y += 1) {
        for (let x = 0; x < tileSize; x += 1) {
          const index = ((row * tileSize + y) * surface.width + column * tileSize + x) * 4;
          const grid = x === 0 || y === 0;
          const shade = blocked ? (grid ? 96 : 58) : (grid ? 208 : 236);
          surface.data[index] = blocked ? shade + 34 : shade - 12;
          surface.data[index + 1] = shade;
          surface.data[index + 2] = blocked ? shade : shade - 30;
          surface.data[index + 3] = 255;
        }
      }
    }
  }
  return surface;
}

/** Paint the flood-fill result: one colour per walkable component. */
function componentOverlay(scene, components) {
  const { columns, rows, tileSize } = scene;
  const surface = createSurface(columns * tileSize, rows * tileSize);
  const palette = [
    [86, 168, 108], [214, 128, 62], [92, 128, 208], [196, 88, 168],
    [206, 190, 72], [88, 190, 196],
  ];
  const componentOf = new Int32Array(columns * rows).fill(-1);
  components.forEach((component, index) => {
    for (const tile of component.tiles) componentOf[tile] = index;
  });
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const id = componentOf[row * columns + column];
      const color = id < 0 ? [34, 38, 44] : palette[id % palette.length];
      for (let y = 0; y < tileSize; y += 1) {
        for (let x = 0; x < tileSize; x += 1) {
          const index = ((row * tileSize + y) * surface.width + column * tileSize + x) * 4;
          const grid = x === 0 || y === 0 ? 0.82 : 1;
          surface.data[index] = color[0] * grid;
          surface.data[index + 1] = color[1] * grid;
          surface.data[index + 2] = color[2] * grid;
          surface.data[index + 3] = 255;
        }
      }
    }
  }
  return surface;
}

// ---------------------------------------------------------------------------
// navigator paths over the bridges
// ---------------------------------------------------------------------------

/** One colour per bridge, chosen to survive on both grass and dark water. */
const PATH_COLORS = [[255, 196, 60], [92, 224, 232], [244, 120, 200]];

/**
 * Walk inland from a bridge abutment, along the bridge's own axis, and return
 * the furthest walkable tile within `reach` - a real place on that bank a being
 * could be standing, and far enough back that the returned route is a journey
 * rather than a single step onto the deck.
 */
function inlandEndpoint(scene, bridge, abutment, reach) {
  const nearestDeck = bridge.deck.reduce((best, candidate) => {
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
      for (let channel = 0; channel < 3; channel += 1) {
        surface.data[index + channel] = color[channel];
      }
      surface.data[index + 3] = 255;
    }
  }
}

/**
 * Draw the REAL `findNavigationPath` route across every bridge onto a copy of
 * the art. Nothing here decides where the route goes: the production navigator
 * is handed the pilot's collision grid and the two bank endpoints, and whatever
 * it returns is what gets painted.
 */
function paintNavigatorPaths(surface, scene, grid, findNavigationPath) {
  const painted = createSurface(surface.width, surface.height);
  painted.data.set(surface.data);
  const routes = [];
  scene.bridges.forEach((bridge, index) => {
    const start = inlandEndpoint(scene, bridge, bridge.abutments[0], 6);
    const goal = inlandEndpoint(scene, bridge, bridge.abutments[1], 6);
    const result = findNavigationPath(grid, { start, goal });
    const color = PATH_COLORS[index % PATH_COLORS.length];
    const deckKeys = new Set(bridge.deck.map((tile) => `${tile.column},${tile.row}`));
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
      bridge: bridge.id,
      start,
      goal,
      status: result.status,
      steps: result.tiles.length,
      deckTilesOnPath: onDeck,
      deckTiles: bridge.deck.length,
    });
  });
  return { painted, routes };
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

/**
 * Renders the CURRENT production Nirvana root chunk through the production
 * Nirvana painter, at the same 1536x1024, so the owner can see the before and
 * the after at the same scale. Read-only: it constructs the locked root chunk
 * and paints it, and touches no asset or hash.
 */
async function renderCurrentNirvanaBaseline(server, outputRoot) {
  const painter = await server.ssrLoadModule(
    "/src/renderer2d/production/nirvana/NirvanaPainter.ts",
  );
  const rootChunk = await server.ssrLoadModule(
    "/src/renderer2d/production/nirvana/NirvanaRootChunk.ts",
  );
  const regionModule = await server.ssrLoadModule(
    "/src/renderer2d/production/nirvana/NirvanaRegionV2.ts",
  );
  const atlasModule = await server.ssrLoadModule(
    "/src/renderer2d/production/nirvana/NirvanaAtlas.ts",
  );
  const profileModule = await server.ssrLoadModule(
    "/src/renderer2d/production/nirvana/NirvanaAssetProfile.ts",
  );

  const assetRoot = path.join(FRONTEND_ROOT, "src/assets/renderer2d/regions/nirvana-v2");
  const terrain = await loadSurface(path.join(assetRoot, "terrain.png"));
  const landmarks = await loadSurface(path.join(assetRoot, "landmarks.png"));
  const assets = atlasModule.createNirvanaAtlasAssets(
    terrain,
    landmarks,
    profileModule.NIRVANA_ATLAS_PROFILE,
  );

  const region = regionModule.createNirvanaRegion(rootChunk.createNirvanaRootChunk());
  const width = regionModule.NIRVANA_CHUNK_COLUMNS * regionModule.NIRVANA_TILE_SIZE;
  const height = regionModule.NIRVANA_CHUNK_ROWS * regionModule.NIRVANA_TILE_SIZE;
  const surface = createSurface(width, height);
  const context = createContext(surface);
  painter.renderNirvanaRegion(context, region, assets, { x: 0, y: 0, width, height });
  const bytes = await writePng(surface, path.join(outputRoot, "nirvana-current-baseline.png"));
  return { width, height, bytes };
}

export async function renderNirvanaValleyPilot(outputRoot = DEFAULT_OUTPUT) {
  const server = await createServer({
    root: FRONTEND_ROOT,
    configFile: path.join(FRONTEND_ROOT, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "warn",
  });
  try {
    const sceneModule = await server.ssrLoadModule(
      "/src/qa/nirvanaValleyPilot/valleyScene.ts",
    );
    const painterModule = await server.ssrLoadModule(
      "/src/qa/nirvanaValleyPilot/valleyPainter.ts",
    );
    const manifest = JSON.parse(
      await (await import("node:fs/promises")).readFile(
        path.join(FRONTEND_ROOT, "src/qa/nirvanaValleyPilot/assets/atlas.json"),
        "utf8",
      ),
    );

    const scene = sceneModule.createValleyScene();
    const plan = painterModule.createValleyPaintPlan(scene, manifest);

    const terrain = await loadSurface(
      path.join(FRONTEND_ROOT, "src/qa/nirvanaValleyPilot/assets/terrain.png"),
    );
    const scenery = await loadSurface(
      path.join(FRONTEND_ROOT, "src/qa/nirvanaValleyPilot/assets/scenery.png"),
    );

    const surface = createSurface(scene.widthPixels, scene.heightPixels);
    const context = createContext(surface);
    painterModule.renderValleyPlan(context, plan, { terrain, scenery });

    const components = sceneModule.walkableComponents(
      scene.collision,
      scene.columns,
      scene.rows,
    );

    const navigationModule = await server.ssrLoadModule(
      "/src/renderer2d/production/navigation/navigation.ts",
    );
    const walkabilityModule = await server.ssrLoadModule(
      "/src/qa/nirvanaValleyPilot/valleyWalkability.ts",
    );
    const { painted, routes } = paintNavigatorPaths(
      surface,
      scene,
      walkabilityModule.toNavigationGrid(scene),
      navigationModule.findNavigationPath,
    );

    await mkdir(outputRoot, { recursive: true });
    const wrote = {
      valley: await writePng(surface, path.join(outputRoot, "valley.png")),
      walkable: await writePng(
        tintBlockedCells(surface, scene),
        path.join(outputRoot, "valley-walkable.png"),
      ),
      mask: await writePng(bareMask(scene), path.join(outputRoot, "valley-mask.png")),
      components: await writePng(
        componentOverlay(scene, components),
        path.join(outputRoot, "valley-components.png"),
      ),
      path: await writePng(painted, path.join(outputRoot, "valley-path.png")),
    };

    const baseline = await renderCurrentNirvanaBaseline(server, outputRoot);

    const blocked = scene.collision.reduce((total, cell) => total + cell, 0);
    return {
      baseline,
      outputRoot,
      width: scene.widthPixels,
      height: scene.heightPixels,
      operations: plan.operations.length,
      props: scene.props.length,
      crossings: scene.crossings.length,
      bridges: scene.bridges.map((bridge) => ({
        id: bridge.id,
        axis: bridge.axis,
        deck: bridge.deck.length,
        abutments: bridge.abutments,
      })),
      routes,
      tiles: scene.tiles.length,
      blockedTiles: blocked,
      walkableTiles: scene.tiles.length - blocked,
      components: components.map((component) => component.tiles.length),
      wrote,
    };
  } finally {
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf("--out");
  const outputRoot = outIndex > 0 ? path.resolve(process.argv[outIndex + 1]) : DEFAULT_OUTPUT;
  renderNirvanaValleyPilot(outputRoot)
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 1)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
