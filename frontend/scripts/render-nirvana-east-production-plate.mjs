/**
 * Renders Nirvana East at 1:1 through the REAL PRODUCTION paint path.
 *
 * This is deliberately NOT a sibling of `render-nirvana-east-plates.mjs`, which
 * renders the QA *pilot* compositions from `src/qa/nirvanaEastPilot`. Nothing here
 * touches the pilot. Every artifact below is produced by the modules production
 * actually boots:
 *
 *   `createProductionRegionMapRecipe`   the dispatch the live world calls
 *     -> `createNirvanaEastRegionMapRecipe`  the exact builder + its scene sidecar
 *     -> `createNirvanaEastStaticScenePlan`  the registered static-scene provider,
 *                                            drained through its own cursor
 *     -> `drawProductionStaticSceneOperation` the production draw op, unmodified
 *
 * The only thing this script supplies is a raw-RGBA `drawImage` backend, because
 * Node has no canvas — identical in shape to `render-nirvana-east-plates.mjs`'s.
 *
 * That distinction is the whole point of the file. The pilot plates were approved
 * by eye months ago; what had never been produced was evidence that the picture
 * SURVIVED the move into production — a different scene builder, a different
 * material table, a different atlas and the generic recipe's own 724 blocked tiles
 * unioned in underneath. This renders exactly that.
 *
 * Per seed, at 3072x3072 (the full canonical region):
 *   `<seed>.png`           the region as the production painter draws it
 *   `<seed>-detail.png`    a 1536x1024 1:1 crop — same size as the approved plates
 *   `<seed>-walkable.png`  blocked ground tinted, all 128 shelter plots outlined
 *   `<seed>-routes.png`    the REAL `findNavigationPath` route across each causeway
 *
 * Usage: `node scripts/render-nirvana-east-production-plate.mjs [outputDir]`
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { createServer } from "vite";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");
const ASSET_ROOT = path.join(
  FRONTEND_ROOT,
  "src/assets/renderer2d/regions/nirvana-east-v1",
);

const TILE_SIZE = 32;
const SEEDS = [401];

/**
 * Where the 1:1 detail crop is taken from, in TILE coords.
 *
 * Chosen to frame the settled core rather than the margin: the shelter band runs
 * through the middle rows, so a crop there shows the terrain doing the job it has
 * to do — carrying the region's identity across ground beings actually stand on.
 */
const DETAIL_ORIGIN = { column: 24, row: 40 };

/**
 * The APPROVED pilot plate's own detail origin for composition B
 * (`render-nirvana-east-plates.mjs`'s `DETAIL_ORIGIN["b-ember-rift"]`).
 *
 * Rendered as a second crop so the production picture can be judged against
 * `b-ember-rift-industrial-detail.png` frame for frame instead of across two
 * different viewports — the comparison the first production pass could not make.
 */
const PILOT_DETAIL_ORIGIN = { column: 30, row: 30 };

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

function cropSurface(surface, x, y, width, height) {
  const crop = createSurface(width, height);
  for (let row = 0; row < height; row += 1) {
    const sourceRow = y + row;
    if (sourceRow < 0 || sourceRow >= surface.height) continue;
    for (let column = 0; column < width; column += 1) {
      const sourceColumn = x + column;
      if (sourceColumn < 0 || sourceColumn >= surface.width) continue;
      const source = (sourceRow * surface.width + sourceColumn) * 4;
      const target = (row * width + column) * 4;
      crop.data.set(surface.data.subarray(source, source + 4), target);
    }
  }
  return crop;
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

function fillTile(surface, column, row, colour, alpha) {
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      blend(surface, column * TILE_SIZE + x, row * TILE_SIZE + y, colour, alpha);
    }
  }
}

// ---------------------------------------------------------------------------
// overlays
// ---------------------------------------------------------------------------

/** Blocked ground tinted red, every shelter plot outlined green (kept) or red (lost). */
function walkabilityPlate(base, recipe, shelterRenderRect) {
  const surface = copySurface(base);
  const { collision, columns, rows } = recipe.grid;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (collision[row * columns + column] === 1) {
        fillTile(surface, column, row, [226, 62, 54], 0.42);
      }
    }
  }
  let lost = 0;
  for (const plot of recipe.shelterPlots) {
    const rect = shelterRenderRect(plot.tile);
    let clear = true;
    for (
      let row = Math.floor(rect.y / TILE_SIZE);
      row <= Math.floor((rect.y + rect.height - 1) / TILE_SIZE);
      row += 1
    ) {
      for (
        let column = Math.floor(rect.x / TILE_SIZE);
        column <= Math.floor((rect.x + rect.width - 1) / TILE_SIZE);
        column += 1
      ) {
        if (column < 0 || row < 0 || column >= columns || row >= rows
          || collision[row * columns + column] === 1) clear = false;
      }
    }
    if (!clear) lost += 1;
    strokeRect(
      surface, rect.x, rect.y, rect.width, rect.height,
      clear ? [86, 214, 122] : [244, 74, 62], 2,
    );
  }
  return { surface, lost };
}

/** The REAL navigator's route across every resolved causeway, both axes. */
function routePlate(base, recipe, causeways, findNavigationPath) {
  const surface = copySurface(base);
  const results = [];
  for (const crossing of causeways) {
    const horizontal = crossing.axis === "east-west";
    const first = crossing.deck[0];
    const last = crossing.deck[crossing.deck.length - 1];
    const start = horizontal
      ? { column: first.column - 1, row: first.row }
      : { column: first.column, row: first.row - 1 };
    const goal = horizontal
      ? { column: last.column + 1, row: last.row }
      : { column: last.column, row: last.row + 1 };
    const route = findNavigationPath(recipe.grid, { start, goal });
    const onRoute = new Set((route.tiles ?? []).map((tile) => `${tile.column},${tile.row}`));
    for (const deck of crossing.deck) {
      fillTile(surface, deck.column, deck.row, [255, 214, 92], 0.55);
    }
    for (const tile of route.tiles ?? []) {
      fillTile(surface, tile.column, tile.row, [92, 178, 255], 0.5);
    }
    const carried = crossing.deck.filter((deck) =>
      onRoute.has(`${deck.column},${deck.row}`)).length;
    results.push({
      id: crossing.id,
      axis: crossing.axis,
      status: route.status,
      deck: crossing.deck.length,
      deckOnRoute: carried,
    });
  }
  return { surface, results };
}

/** `{ key: count }`, descending — a census small enough to read in a report. */
function censusBy(items, key) {
  const tally = new Map();
  for (const item of items) {
    const k = key(item);
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  return Object.fromEntries([...tally].sort((a, b) => b[1] - a[1]));
}

/**
 * How much of the region each material actually COVERS, in quarter-tiles.
 *
 * `tile.material` is the collision/identity label, not the picture: a tile is
 * drawn as its lowest-priority corner material with every higher-priority
 * material laid over it as a corner mask. `ember` has priority 0, so counting
 * `tile.material === "ember"` under-reports the molten ground wherever a core
 * tile holds one ember corner, and over-reports it nowhere. This measures the
 * drawn area instead, which is what the eye judges.
 */
function materialCoverage(tiles) {
  const popcount = (mask) => (mask & 1 ? 1 : 0) + (mask & 2 ? 1 : 0)
    + (mask & 4 ? 1 : 0) + (mask & 8 ? 1 : 0);
  const tally = new Map();
  for (const tile of tiles) {
    let taken = 0;
    for (const overlay of tile.overlays) {
      const quarters = popcount(overlay.mask);
      tally.set(overlay.material, (tally.get(overlay.material) ?? 0) + quarters);
      taken += quarters;
    }
    tally.set(tile.base, (tally.get(tile.base) ?? 0) + Math.max(0, 4 - taken));
  }
  return Object.fromEntries([...tally].sort((a, b) => b[1] - a[1]));
}

// ---------------------------------------------------------------------------

export async function renderNirvanaEastProductionPlate(outputRoot) {
  const server = await createServer({
    root: FRONTEND_ROOT,
    configFile: path.join(FRONTEND_ROOT, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "warn",
  });
  try {
    const P = "/src/renderer2d/production";
    const identityModule = await server.ssrLoadModule(`${P}/maps/RegionMapIdentity.ts`);
    const productionModule = await server.ssrLoadModule(`${P}/maps/ProductionRegionMapRecipe.ts`);
    const eastRecipeModule = await server.ssrLoadModule(
      `${P}/nirvanaEast/NirvanaEastRegionMapRecipe.ts`,
    );
    const providerModule = await server.ssrLoadModule(
      `${P}/nirvanaEast/NirvanaEastStaticSceneProvider.ts`,
    );
    const profileModule = await server.ssrLoadModule(
      `${P}/nirvanaEast/NirvanaEastAssetProfile.ts`,
    );
    const geometryModule = await server.ssrLoadModule(`${P}/productionGeometry.ts`);
    const navigationModule = await server.ssrLoadModule(`${P}/navigation/navigation.ts`);

    const profile = profileModule.NIRVANA_EAST_ATLAS_PROFILE;
    const terrain = await loadSurface(path.join(ASSET_ROOT, "terrain.png"));
    const scenery = await loadSurface(path.join(ASSET_ROOT, "scenery.png"));
    const leases = new Map([
      [profile.terrainAtlasId, { value: terrain }],
      [profile.sceneryAtlasId, { value: scenery }],
    ]);
    const imageFor = new Map([
      [profile.terrainAtlasId, terrain],
      [profile.sceneryAtlasId, scenery],
    ]);

    const makeRegion = (name, description, connections) => ({
      name,
      description,
      connections: [...connections],
      energy_rate: 0.2,
      materials_rate: 0.2,
      current_energy: 40,
      current_materials: 40,
      max_energy: 100,
      max_materials: 100,
    });
    // The real four-region production world (`config/world.yaml`).
    const world = [
      makeRegion("nirvana", "a once-heavenly landscape, now thinning and picked-over", ["warm_springs", "nirvana_east", "nirvana_west"]),
      makeRegion("nirvana_east", "a struggling, near-barren stretch", ["warm_springs", "nirvana"]),
      makeRegion("warm_springs", "hot spring lakes — the least-poor refuge, but no longer plentiful", ["nirvana_west", "nirvana_east", "nirvana"]),
      makeRegion("nirvana_west", "a nuclear wasteland, all but dead", ["warm_springs", "nirvana"]),
    ];

    await mkdir(outputRoot, { recursive: true });
    const summaries = [];

    for (const seed of SEEDS) {
      const identity = identityModule.createRegionMapIdentity(seed, world[1], world);
      const recipe = productionModule.createProductionRegionMapRecipe(identity);
      if (recipe.presentationProfile?.kind !== "nirvana-east-v1") {
        throw new Error(
          "production dispatch did not select the Nirvana East builder — is it wired?",
        );
      }
      const authored = eastRecipeModule.nirvanaEastAuthoredSceneSidecar(recipe);
      if (authored === null) throw new Error("no authored scene sidecar on the recipe");

      const plan = providerModule.createNirvanaEastStaticScenePlan(recipe, leases);
      const width = recipe.grid.columns * TILE_SIZE;
      const height = recipe.grid.rows * TILE_SIZE;
      const surface = createSurface(width, height);
      const context = createContext(surface);
      const staticSceneModule = await server.ssrLoadModule(
        `${P}/staticScene/ProductionStaticScene.ts`,
      );
      const layers = new Map();
      for (const operation of plan.operations) {
        const image = imageFor.get(operation.atlasId);
        if (image === undefined) {
          throw new Error(`plan references an unleased atlas ${operation.atlasId}`);
        }
        staticSceneModule.drawProductionStaticSceneOperation(context, image, operation);
        layers.set(operation.layer, (layers.get(operation.layer) ?? 0) + 1);
      }

      const walk = walkabilityPlate(surface, recipe, geometryModule.shelterRenderRect);
      const route = routePlate(
        surface, recipe, authored.scene.crossings, navigationModule.findNavigationPath,
      );
      const detail = cropSurface(
        surface,
        DETAIL_ORIGIN.column * TILE_SIZE,
        DETAIL_ORIGIN.row * TILE_SIZE,
        1536,
        1024,
      );
      const pilotDetail = cropSurface(
        surface,
        PILOT_DETAIL_ORIGIN.column * TILE_SIZE,
        PILOT_DETAIL_ORIGIN.row * TILE_SIZE,
        1536,
        1024,
      );
      // A crop centred on the settled band, so "are there landforms where beings
      // live?" is judged on the settlement itself rather than on the margin.
      const bandDetail = cropSurface(
        surface, 18 * TILE_SIZE, 30 * TILE_SIZE, 1536, 1024,
      );

      const blocked = recipe.grid.collision.reduce((sum, value) => sum + value, 0);
      const wrote = {
        plate: await writePng(surface, path.join(outputRoot, `${seed}.png`)),
        detail: await writePng(detail, path.join(outputRoot, `${seed}-detail.png`)),
        pilotDetail: await writePng(
          pilotDetail, path.join(outputRoot, `${seed}-detail-pilot-viewport.png`),
        ),
        bandDetail: await writePng(
          bandDetail, path.join(outputRoot, `${seed}-detail-settled-band.png`),
        ),
        walkable: await writePng(walk.surface, path.join(outputRoot, `${seed}-walkable.png`)),
        routes: await writePng(route.surface, path.join(outputRoot, `${seed}-routes.png`)),
      };

      summaries.push({
        seed,
        sceneHash: recipe.presentationProfile.staticSceneHash,
        operations: plan.operations.length,
        layers: Object.fromEntries([...layers].sort()),
        props: authored.scene.props.length,
        landforms: authored.scene.landforms.length,
        landformTiers: censusBy(authored.scene.landforms, (placement) => placement.tier),
        crossings: authored.scene.crossings.length,
        material: censusBy(authored.scene.tiles, (tile) => tile.material),
        materialCoverageQuarters: materialCoverage(authored.scene.tiles),
        blockedTiles: blocked,
        blockedPct: +(blocked / (recipe.grid.columns * recipe.grid.rows) * 100).toFixed(2),
        shelterPlots: recipe.shelterPlots.length,
        shelterPlotsLost: walk.lost,
        animatedEnvironment: recipe.animatedEnvironment.length,
        routes: route.results,
        wrote,
      });
    }
    console.log(JSON.stringify(summaries, null, 2));
    return summaries;
  } finally {
    await server.close();
  }
}

const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const output = process.argv[2] ?? path.resolve(
    FRONTEND_ROOT, "..", "docs/frontend/mockups/regions/nirvana-east-production",
  );
  await renderNirvanaEastProductionPlate(output);
}
