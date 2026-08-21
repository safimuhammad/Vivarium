/**
 * Renders the three Nirvana West PILOT compositions to native-scale plates.
 *
 * Sibling of `render-warm-springs-plates.mjs` / `render-nirvana-east-plates.mjs`:
 * same discipline. The scene, frame vocabulary and paint plan all come from the
 * pilot's TypeScript modules loaded through Vite's SSR loader, and the plan is
 * executed by the PRODUCTION `drawProductionStaticSceneOperation`. The only thing
 * this script supplies is a raw-RGBA `drawImage` backend, because Node has no
 * canvas.
 *
 * Per composition, at 3072x3072 (the full canonical region):
 *   <id>.png            the terrain as the real painter draws it, animated
 *                        environment (fire/smoke/heat-haze) baked in at nowMs=0
 *   <id>-walkable.png   blocked cells tinted + all 128 shelter plots
 *                        outlined, green = buildable, red = lost
 *   <id>-mask.png        the bare walkability mask
 *   <id>-detail.png      a 1536x1024 1:1 crop, same size as the approved
 *                        Nirvana/Warm Springs/Nirvana East plates
 *   <id>-routes.png      the REAL findNavigationPath route across every
 *                        causeway, on a TOROIDAL grid (contract: every
 *                        region wraps now, see `render-nirvana-west-wrap-check.mjs`)
 *   <id>-fire-strip.png  the SAME detail crop rendered at all four animated-
 *                        environment phases (nowMs 0/160/320/480), stacked as
 *                        a 2x2 grid at 1:1 so the fire/smoke motion can be
 *                        judged frame to frame
 *
 * `map-scale.png` and the wrap plates are NOT produced here — see
 * `render-nirvana-west-map-scale.mjs` and `render-nirvana-west-wrap-check.mjs`,
 * matching how `render-warm-springs-plates.mjs` itself is plates-only.
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
  "docs/frontend/mockups/regions/nirvana-west-pilot",
);

const PILOT = "/src/qa/nirvanaWestPilot";

/** The v2 ruin species, for the per-plate ruin count in the summary. */
const RUIN_SPECIES = new Set([
  "monolith", "slumpwall", "boneforest", "ashbarrow",
  "coolingtower", "reactorhusk", "gantry", "stack", "pylon",
]);
const ASSET_ROOT = path.join(FRONTEND_ROOT, "src/qa/nirvanaWestPilot/assets");

/**
 * Where each composition's 1536x1024 detail crop is taken from (tile coords).
 * Chosen to frame the composition's best feature (contract):
 *   A — a drift crest running past the focal scour basin
 *   B — a branching ember fissure with a causeway over it
 *   C — upthrust slabs with ash drifted against their lee edges and a
 *       slumped joint crossing
 * Tuned after the first visual pass; see the report for the by-eye verdict.
 */
const DETAIL_ORIGIN = {
  // Focal scour basin is centred at tile (30, 4) with rings out to r<18
  // (nirvanaWestScene.ts `ASHFALL_BASIN_CENTER`) — frame it plus the
  // diagonal drift bands (period 48) that cross past it.
  "a-ashfall-drifts": { column: 4, row: 0 },
  // Trunk 1's authored causeway anchor sits at (column 6, row 74)
  // (`EMBER_TRUNKS[0]` / crossing plan `b-ew-trunk1`) — frame the branching
  // fracture fanning out from it plus the causeway crossing.
  "b-ember-rift": { column: 0, row: 54 },
  // Causeways `c-ew-joint` (row 8, columns 3-10) and `c-ns-joint` (column 0,
  // rows 11-18) both land near the NW corner — frame it to catch the visible
  // vertical crossing, upthrust rubble, slab joints and lee-edge ash drift.
  "c-shattered-pavement": { column: 0, row: 0 },
};

// ---------------------------------------------------------------------------
// raw RGBA surface + the minimal 2D context the production draw op needs
// (identical to render-warm-springs-plates.mjs / render-nirvana-east-plates.mjs)
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

/** Fill every pixel with an opaque solid colour - used for the fire-strip's dark gutter. */
function fillSolid(surface, colour) {
  for (let index = 0; index < surface.width * surface.height; index += 1) {
    const target = index * 4;
    surface.data[target] = colour[0];
    surface.data[target + 1] = colour[1];
    surface.data[target + 2] = colour[2];
    surface.data[target + 3] = 255;
  }
}

/** Opaque 1:1 copy of `src` into `dest` at `(dx, dy)`, no scaling, no blending. */
function pasteInto(dest, src, dx, dy) {
  for (let row = 0; row < src.height; row += 1) {
    const targetY = dy + row;
    if (targetY < 0 || targetY >= dest.height) continue;
    for (let column = 0; column < src.width; column += 1) {
      const targetX = dx + column;
      if (targetX < 0 || targetX >= dest.width) continue;
      const source = (row * src.width + column) * 4;
      const target = (targetY * dest.width + targetX) * 4;
      dest.data[target] = src.data[source];
      dest.data[target + 1] = src.data[source + 1];
      dest.data[target + 2] = src.data[source + 2];
      dest.data[target + 3] = src.data[source + 3];
    }
  }
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
 * Every causeway (`scene.causeways` — this region's boardwalk-equivalent)
 * traversed by the REAL navigator, drawn tile by tile, on a TOROIDAL grid —
 * every region wraps now (RegionMapRecipe.ts's `REGION_WALK_TOPOLOGY`), so
 * the grid passed to `findNavigationPath` here always carries
 * `topology: "toroidal"` explicitly rather than relying on
 * `toNavigationGrid`'s (bounded-by-default) shape.
 */
function routePlate(base, scene, grid, findNavigationPath) {
  const surface = copySurface(base);
  const toroidalGrid = { ...grid, topology: "toroidal" };
  const palette = [
    [255, 214, 92], [126, 214, 255], [255, 138, 196],
    [154, 255, 154], [255, 176, 96], [188, 156, 255],
  ];
  const routes = [];
  sceneCauseways(scene).forEach((causeway, index) => {
    const colour = palette[index % palette.length];
    const deck = causeway.deck;
    const first = deck[0];
    const last = deck[deck.length - 1];
    const reach = 6;
    const start = causeway.axis === "east-west"
      ? { column: Math.max(0, first.column - reach), row: first.row }
      : { column: first.column, row: Math.max(0, first.row - reach) };
    const goal = causeway.axis === "east-west"
      ? { column: Math.min(scene.columns - 1, last.column + reach), row: last.row }
      : { column: last.column, row: Math.min(scene.rows - 1, last.row + reach) };
    const result = findNavigationPath(toroidalGrid, { start, goal });
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
      causeway: causeway.id,
      axis: causeway.axis,
      status: result.status,
      steps: (result.tiles ?? []).length,
      deckLength: deck.length,
      onDeck,
    });
  });
  return { surface, routes };
}

/**
 * `nirvanaWestScene.ts`'s `NirvanaWestScene.causeways` field is mid-rename
 * (its TYPE declares `causeways`; at the time this script was written the
 * BUILDER still returned the field under its old name, `crossings` — the
 * same field the Nirvana East sibling calls `NirvanaEastScene.crossings`).
 * Read whichever is actually present so this script keeps working across
 * that in-flight rename rather than hard-failing on it.
 */
function sceneCauseways(scene) {
  return scene.causeways ?? scene.crossings ?? [];
}

const FIRE_STRIP_PHASES_MS = Object.freeze([0, 160, 320, 480]);
const FIRE_STRIP_GUTTER = 8;
const FIRE_STRIP_BACKGROUND = [12, 9, 16];
const FIRE_STRIP_GRID_POSITIONS = Object.freeze([[0, 0], [1, 0], [0, 1], [1, 1]]);

/**
 * The detail crop region rendered at each of the four animated-environment
 * phases (`nirvanaWestAnimationPhase`'s 640ms cycle = 4 * 160ms), stacked as
 * a 2x2 grid at 1:1 (no scaling) with a dark gutter, so fire/smoke motion can
 * be judged frame to frame. `staticSurface` is the STATIC-only render (no
 * animated ops baked in) - reused as the base for all four phases so the
 * expensive terrain+scenery rasterisation happens only once, not four times.
 */
function buildFireStrip(painterModule, staticSurface, animatedOps, sources, origin, tileSize) {
  const cropWidth = 1536;
  const cropHeight = 1024;
  const crops = FIRE_STRIP_PHASES_MS.map((nowMs) => {
    const phaseSurface = copySurface(staticSurface);
    const animatedOnlyPlan = {
      plan: { cacheIdentity: "nirvana-west-fire-strip-animated-only", operations: [] },
      animated: animatedOps,
    };
    painterModule.renderNirvanaWestFullPlan(
      createContext(phaseSurface), animatedOnlyPlan, sources, { x: 0, y: 0 }, nowMs, false,
    );
    return cropSurface(
      phaseSurface, origin.column * tileSize, origin.row * tileSize, cropWidth, cropHeight,
    );
  });

  const stripWidth = cropWidth * 2 + FIRE_STRIP_GUTTER * 3;
  const stripHeight = cropHeight * 2 + FIRE_STRIP_GUTTER * 3;
  const strip = createSurface(stripWidth, stripHeight);
  fillSolid(strip, FIRE_STRIP_BACKGROUND);
  crops.forEach((crop, index) => {
    const [col, row] = FIRE_STRIP_GRID_POSITIONS[index];
    const dx = FIRE_STRIP_GUTTER + col * (cropWidth + FIRE_STRIP_GUTTER);
    const dy = FIRE_STRIP_GUTTER + row * (cropHeight + FIRE_STRIP_GUTTER);
    pasteInto(strip, crop, dx, dy);
  });
  return strip;
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

export async function renderNirvanaWestPlates(outputRoot = DEFAULT_OUTPUT) {
  const server = await createServer({
    root: FRONTEND_ROOT,
    configFile: path.join(FRONTEND_ROOT, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "warn",
  });
  try {
    const sceneModule = await server.ssrLoadModule(`${PILOT}/nirvanaWestScene.ts`);
    const painterModule = await server.ssrLoadModule(`${PILOT}/nirvanaWestPainter.ts`);
    const walkModule = await server.ssrLoadModule(`${PILOT}/nirvanaWestWalkability.ts`);
    const navigationModule = await server.ssrLoadModule(
      "/src/renderer2d/production/navigation/navigation.ts",
    );

    const manifest = JSON.parse(await readFile(path.join(ASSET_ROOT, "atlas.json"), "utf8"));
    const terrain = await loadSurface(path.join(ASSET_ROOT, "terrain.png"));
    const scenery = await loadSurface(path.join(ASSET_ROOT, "scenery.png"));
    const environment = await loadSurface(path.join(ASSET_ROOT, "environment.png"));
    const sources = { terrain, scenery, environment };
    await mkdir(outputRoot, { recursive: true });

    const summaries = [];
    // Every composition in the default ("ancient") ruin kit, plus one extra
    // pass over the recommended composition dressed with the INDUSTRIAL kit so
    // the owner can compare the two lore readings side by side at native size.
    const passes = [
      ...sceneModule.NIRVANA_WEST_COMPOSITION_IDS.map((id) => ({ id, ruinKit: "ancient", suffix: "" })),
      { id: "b-ember-rift", ruinKit: "industrial", suffix: "-industrial" },
    ];
    for (const pass of passes) {
      const { id: compositionId, ruinKit, suffix } = pass;
      const id = `${compositionId}${suffix}`;
      const scene = sceneModule.createNirvanaWestScene(compositionId, ruinKit);
      const fullPlan = painterModule.createNirvanaWestFullPaintPlan(scene, manifest);

      // The static picture (terrain + scenery + emberwisp pass) is rendered
      // ONCE and reused as the base for the main plate AND every fire-strip
      // phase, so the animated environment is the only thing re-rasterised
      // per phase (mirrors the viewer's own static/animated split).
      const staticSurface = createSurface(scene.widthPixels, scene.heightPixels);
      painterModule.renderNirvanaWestPlan(createContext(staticSurface), fullPlan.plan, sources);

      const surface = copySurface(staticSurface);
      const animatedOnlyMainPlan = {
        plan: { cacheIdentity: fullPlan.plan.cacheIdentity, operations: [] },
        animated: fullPlan.animated,
      };
      painterModule.renderNirvanaWestFullPlan(
        createContext(surface), animatedOnlyMainPlan, sources, { x: 0, y: 0 }, 0, false,
      );

      const plots = walkModule.shelterPlotReport(scene);
      const grid = walkModule.toNavigationGrid(scene);
      const components = sceneModule.walkableComponents(
        scene.collision, scene.columns, scene.rows,
      );
      const seam = sceneModule.verifyToroidalSeam(scene);
      const animatedEnvironment = sceneModule.animatedEnvironmentReport(scene);

      const walk = walkabilityPlate(surface, scene, plots);
      const route = routePlate(surface, scene, grid, navigationModule.findNavigationPath);
      const origin = DETAIL_ORIGIN[compositionId] ?? { column: 0, row: 0 };
      const detail = cropSurface(
        surface, origin.column * scene.tileSize, origin.row * scene.tileSize, 1536, 1024,
      );
      const fireStrip = buildFireStrip(
        painterModule, staticSurface, fullPlan.animated, sources, origin, scene.tileSize,
      );

      const wrote = {
        plate: await writePng(surface, path.join(outputRoot, `${id}.png`)),
        walkable: await writePng(walk.surface, path.join(outputRoot, `${id}-walkable.png`)),
        mask: await writePng(bareMask(scene), path.join(outputRoot, `${id}-mask.png`)),
        detail: await writePng(detail, path.join(outputRoot, `${id}-detail.png`)),
        routes: await writePng(route.surface, path.join(outputRoot, `${id}-routes.png`)),
        fireStrip: await writePng(fireStrip, path.join(outputRoot, `${id}-fire-strip.png`)),
      };

      const blocked = scene.collision.reduce((total, cell) => total + cell, 0);
      const causewaysByAxis = { "east-west": 0, "north-south": 0 };
      for (const causeway of sceneCauseways(scene)) causewaysByAxis[causeway.axis] += 1;

      const summary = {
        composition: id,
        ruinKit,
        identityInView: walkModule.identityVisibilityReport(scene),
        ruinProps: scene.props.filter((prop) => RUIN_SPECIES.has(prop.frameId.split(".")[1])).length,
        tiles: scene.collision.length,
        walkable: scene.collision.length - blocked,
        blocked,
        blockedPct: Number(((100 * blocked) / scene.collision.length).toFixed(2)),
        components: components.length,
        componentSizes: components.map((component) => component.tiles?.length ?? component.length),
        plotsClear: plots.clear,
        plotsLost: plots.lost,
        demotedTiles: scene.demotedTiles,
        toroidalSeam: seam,
        drawOperations: fullPlan.plan.operations.length,
        animatedOperations: fullPlan.animated.length,
        animatedEnvironment,
        props: scene.props.length,
        causewaysByAxis,
        causeways: route.routes,
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
        environment: (await sharp(path.join(ASSET_ROOT, "environment.png")).toBuffer()).length,
      },
      summaries,
    };
  } finally {
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf("--out");
  renderNirvanaWestPlates(outIndex > 0 ? path.resolve(process.argv[outIndex + 1]) : DEFAULT_OUTPUT)
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 1)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
