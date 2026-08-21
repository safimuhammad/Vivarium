/**
 * Why is each Nirvana West shelter plot lost?
 *
 * A composition that loses plots is not automatically wrong — but it must be
 * lost for a REASON someone can look at and price. This prints, per composition,
 * every lost plot with the offending tiles and the material that blocked them,
 * plus a histogram of blocking materials and where in the grid the damage sits.
 *
 * The shelter-plot demotion pass in `nirvanaWestScene.ts` is designed to make
 * `plotsLost` always 0 by construction, so a non-empty report here means the
 * demotion pass itself has a bug — this script is the honest check on that claim.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");

async function main() {
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
    const plots = walk.allShelterPlots();

    for (const id of scene.NIRVANA_WEST_COMPOSITION_IDS) {
      const built = scene.createNirvanaWestScene(id);
      const byMaterial = new Map();
      const lost = [];
      for (const plot of plots) {
        const { column: c, row: r } = plot.tile;
        const offenders = [];
        for (let row = r; row <= r + 4; row += 1) {
          for (let column = c; column <= c + 4; column += 1) {
            if (built.collision[row * built.columns + column] === 1) {
              const material = built.tiles[row * built.columns + column].material;
              offenders.push({ column, row, material });
              byMaterial.set(material, (byMaterial.get(material) ?? 0) + 1);
            }
          }
        }
        if (offenders.length > 0) {
          lost.push({ plot: plot.id, tile: plot.tile, count: offenders.length, offenders });
        }
      }
      process.stdout.write(`\n=== ${id} — ${lost.length} plots lost ===\n`);
      process.stdout.write(`blocking materials on plot ground: ${JSON.stringify(
        Object.fromEntries([...byMaterial].sort((a, b) => b[1] - a[1])),
      )}\n`);
      // which districts are hit
      const districts = new Map();
      for (const entry of lost) {
        const key = entry.plot.split(":")[1] ?? entry.plot;
        districts.set(key, (districts.get(key) ?? 0) + 1);
      }
      process.stdout.write(`by district: ${JSON.stringify(Object.fromEntries(districts))}\n`);
      // the worst few, with detail
      for (const entry of lost.sort((a, b) => b.count - a.count).slice(0, 6)) {
        const materials = [...new Set(entry.offenders.map((o) => o.material))].join(",");
        process.stdout.write(
          `  ${entry.plot} tile(${entry.tile.column},${entry.tile.row}) `
          + `${entry.count}/25 tiles blocked by [${materials}]\n`,
        );
      }
    }
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
