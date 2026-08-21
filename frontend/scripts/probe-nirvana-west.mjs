/**
 * Read-only probe over the REAL production Nirvana West recipe + scene.
 *
 * Dumps, per seed: the material histogram, the placed-species census, the
 * protection-mask density per row band, and an ASCII map of protection vs plains
 * so an authored industrial layout can be designed against measured ground rather
 * than guessed at.
 *
 * Usage: `node scripts/probe-nirvana-west.mjs [seed...]`
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");

const COLUMNS = 96;
const ROWS = 96;

const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
const SEEDS = seeds.length > 0 ? seeds : [401];

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
  const westRecipeModule = await server.ssrLoadModule(
    `${P}/nirvanaWest/NirvanaWestRegionMapRecipe.ts`,
  );

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
  const world = [
    makeRegion("nirvana", "a once-heavenly landscape, now thinning and picked-over", ["warm_springs", "nirvana_east", "nirvana_west"]),
    makeRegion("nirvana_east", "a struggling, near-barren stretch", ["warm_springs", "nirvana"]),
    makeRegion("warm_springs", "hot spring lakes — the least-poor refuge, but no longer plentiful", ["nirvana_west", "nirvana_east", "nirvana"]),
    makeRegion("nirvana_west", "a nuclear wasteland, all but dead", ["warm_springs", "nirvana"]),
  ];

  for (const seed of SEEDS) {
    const identity = identityModule.createRegionMapIdentity(seed, world[3], world);
    const recipe = productionModule.createProductionRegionMapRecipe(identity);
    const authored = westRecipeModule.nirvanaWestAuthoredSceneSidecar(recipe);
    const scene = authored.scene;
    const protection = westRecipeModule.nirvanaWestProtectionFromRecipe(recipe);

    const materials = new Map();
    for (const tile of scene.tiles) {
      materials.set(tile.material, (materials.get(tile.material) ?? 0) + 1);
    }
    const species = new Map();
    for (const prop of scene.props) {
      species.set(prop.species, (species.get(prop.species) ?? 0) + 1);
    }

    let protectedCount = 0;
    for (const v of protection.protected) protectedCount += v;

    const rowBands = [];
    for (let band = 0; band < 12; band += 1) {
      let count = 0;
      for (let row = band * 8; row < band * 8 + 8; row += 1) {
        for (let column = 0; column < COLUMNS; column += 1) {
          count += protection.protected[row * COLUMNS + column];
        }
      }
      rowBands.push({ rows: `${band * 8}-${band * 8 + 7}`, protectedTiles: count });
    }

    // Per-row protection count, so plot-free bands are visible.
    const perRow = [];
    for (let row = 0; row < ROWS; row += 1) {
      let count = 0;
      for (let column = 0; column < COLUMNS; column += 1) count += protection.protected[row * COLUMNS + column];
      perRow.push(count);
    }

    console.log(`===== seed ${seed} =====`);
    console.log("sceneHash", recipe.presentationProfile.staticSceneHash);
    console.log("blocked", recipe.grid.collision.reduce((s, v) => s + v, 0));
    console.log("protectedTiles", protectedCount, `${(protectedCount / (COLUMNS * ROWS) * 100).toFixed(1)}%`);
    console.log("materials", JSON.stringify(Object.fromEntries([...materials].sort((a, b) => b[1] - a[1]))));
    console.log("species", JSON.stringify(Object.fromEntries([...species].sort((a, b) => b[1] - a[1]))));
    console.log("props", scene.props.length, "droppedForProtection", scene.droppedForProtection, "demoted", scene.demotedTiles);
    console.log("protection per row band", JSON.stringify(rowBands));
    console.log("protection per row", perRow.join(","));

    // ASCII map: '#' protected, 'E' ember, 'e' emberdim, 'X' blocked, '.' plain
    const lines = [];
    for (let row = 0; row < ROWS; row += 1) {
      let line = "";
      for (let column = 0; column < COLUMNS; column += 1) {
        const index = row * COLUMNS + column;
        const tile = scene.tiles[index];
        if (protection.protected[index] === 1) line += "#";
        else if (tile.material === "ember") line += "E";
        else if (tile.material === "emberdim") line += "e";
        else if (tile.blocked) line += "X";
        else if (tile.material === "slab") line += "S";
        else if (tile.material === "spoil") line += "s";
        else line += ".";
      }
      lines.push(`${String(row).padStart(2, "0")} ${line}`);
    }
    console.log(lines.join("\n"));
  }
} finally {
  await server.close();
}
