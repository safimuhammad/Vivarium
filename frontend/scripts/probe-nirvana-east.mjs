/**
 * Read-only probe over the REAL production Nirvana East recipe + scene.
 *
 * Reports the landform count and TIER MIX, split by whether the object stands
 * inside the settled band (the bounding box of the 128 shelter plots) or in the
 * outer margin, plus the causeway/landform overlap. Read-only; publishes nothing.
 *
 * Usage: `node scripts/probe-nirvana-east.mjs [seed...]`
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");
const COLUMNS = 96;

const argSeeds = process.argv.slice(2).map(Number).filter(Number.isFinite);
const SEEDS = argSeeds.length > 0 ? argSeeds : [401, 229, 7, 1337];

const server = await createServer({
  root: FRONTEND_ROOT,
  configFile: path.join(FRONTEND_ROOT, "vite.config.ts"),
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "warn",
});

try {
  const P = "/src/renderer2d/production";
  const idm = await server.ssrLoadModule(`${P}/maps/RegionMapIdentity.ts`);
  const pm = await server.ssrLoadModule(`${P}/maps/ProductionRegionMapRecipe.ts`);
  const em = await server.ssrLoadModule(`${P}/nirvanaEast/NirvanaEastRegionMapRecipe.ts`);

  const mk = (name, description, connections) => ({
    name, description, connections: [...connections],
    energy_rate: 0.2, materials_rate: 0.2,
    current_energy: 40, current_materials: 40, max_energy: 100, max_materials: 100,
  });
  const world = [
    mk("nirvana", "a once-heavenly landscape, now thinning and picked-over", ["warm_springs", "nirvana_east", "nirvana_west"]),
    mk("nirvana_east", "a struggling, near-barren stretch", ["warm_springs", "nirvana"]),
    mk("warm_springs", "hot spring lakes — the least-poor refuge, but no longer plentiful", ["nirvana_west", "nirvana_east", "nirvana"]),
    mk("nirvana_west", "a nuclear wasteland, all but dead", ["warm_springs", "nirvana"]),
  ];

  for (const seed of SEEDS) {
    const recipe = pm.createProductionRegionMapRecipe(idm.createRegionMapIdentity(seed, world[1], world));
    const authored = em.nirvanaEastAuthoredSceneSidecar(recipe);
    const scene = authored.scene;

    // The settled band: the bounding box of the 128 shelter plots.
    let minC = 96; let maxC = -1; let minR = 96; let maxR = -1;
    for (const plot of recipe.shelterPlots) {
      minC = Math.min(minC, plot.tile.column); maxC = Math.max(maxC, plot.tile.column);
      minR = Math.min(minR, plot.tile.row); maxR = Math.max(maxR, plot.tile.row);
    }
    const inside = (c, r) => c >= minC && c <= maxC && r >= minR && r <= maxR;

    const tally = { total: {}, interior: {}, margin: {} };
    const bump = (bucket, tier) => { bucket[tier] = (bucket[tier] ?? 0) + 1; };
    for (const placement of scene.landforms) {
      bump(tally.total, placement.tier);
      // Judge by the FOOTPRINT centre, not the sprite pivot.
      let sc = 0; let sr = 0;
      for (const tile of placement.footprint) { sc += tile.column; sr += tile.row; }
      const c = Math.round(sc / placement.footprint.length);
      const r = Math.round(sr / placement.footprint.length);
      bump(inside(c, r) ? tally.interior : tally.margin, placement.tier);
    }

    const footprintTiles = new Set();
    for (const placement of scene.landforms) {
      for (const tile of placement.footprint) footprintTiles.add(tile.row * COLUMNS + tile.column);
    }
    const crossings = scene.crossings.map((crossing) => {
      const total = crossing.deck.length;
      const insideRock = crossing.deck.filter((ref) =>
        footprintTiles.has(ref.row * COLUMNS + ref.column)).length;
      return { id: crossing.id, axis: crossing.axis, deck: total, deckInsideLandform: insideRock };
    });

    console.log(`=== seed ${seed} hash ${recipe.presentationProfile.staticSceneHash}`);
    console.log(`  settled band columns ${minC}-${maxC} rows ${minR}-${maxR}`);
    console.log("  landforms total   ", scene.landforms.length, JSON.stringify(tally.total));
    console.log("  ... in the settled band", JSON.stringify(tally.interior));
    console.log("  ... in the margin      ", JSON.stringify(tally.margin));
    console.log("  crossings", JSON.stringify(crossings));
    console.log("  props", scene.props.length);
  }
} finally {
  await server.close();
}
