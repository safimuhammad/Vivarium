/**
 * Measures the three Warm Springs pilot compositions WITHOUT rendering them.
 *
 * The numbers that decide whether a composition is buildable — shelter-plot cost,
 * walkable connectivity, and whether the region's identity is visible from where
 * beings actually live — all fall out of the material field and the collision
 * mask alone. None of them need art. So they are measured here, first and
 * independently, rather than waiting on a 3072x3072 render.
 *
 * Usage:  node scripts/measure-warm-springs-compositions.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");

export async function measureWarmSpringsCompositions() {
  const server = await createServer({
    root: FRONTEND_ROOT,
    configFile: path.join(FRONTEND_ROOT, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "warn",
  });
  try {
    const scene = await server.ssrLoadModule("/src/qa/warmSpringsPilot/springsScene.ts");
    const walk = await server.ssrLoadModule("/src/qa/warmSpringsPilot/springsWalkability.ts");

    const results = [];
    for (const id of scene.WARM_SPRINGS_COMPOSITION_IDS) {
      const built = scene.createWarmSpringsScene(id);
      const blocked = built.collision.reduce((total, cell) => total + cell, 0);
      const walkable = built.collision.length - blocked;
      const components = scene.walkableComponents(
        built.collision,
        built.columns,
        built.rows,
      );
      const plots = walk.shelterPlotReport(built);
      const visibility = walk.springVisibilityReport(built);

      results.push({
        composition: id,
        tiles: built.collision.length,
        walkable,
        blocked,
        blockedPercent: Number(((blocked / built.collision.length) * 100).toFixed(1)),
        components: components.length,
        largestComponent: Math.max(...components.map((c) => c.tiles.length)),
        plotsClear: plots.clear ?? plots.clearCount,
        plotsLost: plots.lost ?? plots.lostCount,
        plotsTotal: plots.total ?? 128,
        plotsWithSpringInView: visibility.plotsWithSpringInView ?? visibility.inView,
        medianDistance: visibility.medianDistance,
        maxDistance: visibility.maxDistance,
        boardwalks: built.boardwalks.map((b) => ({
          id: b.id,
          axis: b.axis,
          deck: b.deck.length,
        })),
        props: built.props.length,
      });
    }
    return results;
  } finally {
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  measureWarmSpringsCompositions()
    .then((results) => {
      process.stdout.write(`${JSON.stringify(results, null, 1)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
