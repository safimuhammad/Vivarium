/**
 * Measures the three Nirvana West pilot compositions WITHOUT rendering them.
 *
 * The numbers that decide whether a composition is buildable — shelter-plot cost,
 * walkable connectivity, toroidal seam continuity, and whether the region's
 * identity is visible from where beings actually live — all fall out of the
 * material field and the collision mask alone. None of them need art. So they
 * are measured here, first and independently, rather than waiting on a render.
 *
 * Also proves the wrap seams with the REAL production `findNavigationPath`
 * (under `topology: "toroidal"`), not just this scene's own flood fill, and
 * reports walkable-tile counts in rows 0-16 / 80-95 (the toroidal wrap band
 * where the generic recipe's `LANDSCAPE_SECTORS` anchor their scenic clusters).
 *
 * Usage:  node scripts/measure-nirvana-west-compositions.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");

function bandWalkable(built, rowStart, rowEnd) {
  let count = 0;
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let column = 0; column < built.columns; column += 1) {
      if (built.collision[row * built.columns + column] === 0) count += 1;
    }
  }
  return count;
}

function proveSeamCrossing(nav, grid, built, axis) {
  if (axis === "east-west") {
    for (let row = 0; row < built.rows; row += 1) {
      const west = { column: built.columns - 1, row };
      const east = { column: 0, row };
      if (
        built.collision[row * built.columns + west.column] === 0
        && built.collision[row * built.columns + east.column] === 0
      ) {
        const result = nav.findNavigationPath(grid, { start: west, goal: east });
        return { attempted: true, status: result.status, tiles: result.tiles.length, at: row };
      }
    }
  } else {
    for (let column = 0; column < built.columns; column += 1) {
      const north = { column, row: built.rows - 1 };
      const south = { column, row: 0 };
      if (
        built.collision[north.row * built.columns + column] === 0
        && built.collision[south.row * built.columns + column] === 0
      ) {
        const result = nav.findNavigationPath(grid, { start: north, goal: south });
        return { attempted: true, status: result.status, tiles: result.tiles.length, at: column };
      }
    }
  }
  return { attempted: false, status: "no-eligible-seam-pair", tiles: 0, at: -1 };
}

export async function measureNirvanaWestCompositions() {
  const server = await createServer({
    root: FRONTEND_ROOT,
    configFile: path.join(FRONTEND_ROOT, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "warn",
  });
  try {
    const scene = await server.ssrLoadModule("/src/qa/nirvanaWestPilot/nirvanaWestScene.ts");
    const walk = await server.ssrLoadModule("/src/qa/nirvanaWestPilot/nirvanaWestWalkability.ts");
    const nav = await server.ssrLoadModule("/src/renderer2d/production/navigation/navigation.ts");

    const results = [];
    for (const id of scene.NIRVANA_WEST_COMPOSITION_IDS) {
      const built = scene.createNirvanaWestScene(id);
      const blocked = built.collision.reduce((total, cell) => total + cell, 0);
      const walkable = built.collision.length - blocked;
      const components = scene.walkableComponents(built.collision, built.columns, built.rows);
      const plots = walk.shelterPlotReport(built);
      const visibility = walk.identityVisibilityReport(built);
      const seam = scene.verifyToroidalSeam(built);

      const materialHistogram = {};
      for (const tile of built.tiles) {
        materialHistogram[tile.material] = (materialHistogram[tile.material] ?? 0) + 1;
      }

      const causewaysByAxis = { "east-west": 0, "north-south": 0 };
      for (const causeway of built.causeways) causewaysByAxis[causeway.axis] += 1;

      const grid = walk.toNavigationGrid(built);

      results.push({
        composition: id,
        tiles: built.collision.length,
        walkable,
        blocked,
        blockedPercent: Number(((blocked / built.collision.length) * 100).toFixed(1)),
        componentCount: components.length,
        largestComponent: Math.max(...components.map((c) => c.tiles.length)),
        plotsClear: plots.clear,
        plotsLost: plots.lost,
        plotsTotal: plots.total,
        demotedTiles: built.demotedTiles,
        plotsWithIdentityInView: visibility.plotsWithIdentityInView,
        medianDistance: visibility.medianDistance,
        maxDistance: visibility.maxDistance,
        causewaysByAxis,
        causeways: built.causeways.map((c) => ({ id: c.id, axis: c.axis, deck: c.deck.length })),
        props: built.props.length,
        toroidalSeam: seam,
        islandBand: {
          rows0to16Walkable: bandWalkable(built, 0, 16),
          rows80to95Walkable: bandWalkable(built, 80, 95),
        },
        navigatorProof: {
          eastWest: proveSeamCrossing(nav, grid, built, "east-west"),
          northSouth: proveSeamCrossing(nav, grid, built, "north-south"),
        },
        materialHistogram,
      });
    }
    return results;
  } finally {
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  measureNirvanaWestCompositions()
    .then((results) => {
      process.stdout.write(`${JSON.stringify(results, null, 1)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
