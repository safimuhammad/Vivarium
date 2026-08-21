/**
 * Measures the three Nirvana East pilot compositions WITHOUT rendering them.
 *
 * The numbers that decide whether a composition is buildable — shelter-plot cost,
 * walkable connectivity (TOROIDAL), the torus seam invariant, wrap-opening counts,
 * identity visibility, and crossing usability — all fall out of the material field
 * and the collision mask alone. None of them need art. So they are measured here,
 * first and independently, rather than waiting on a 3072x3072 render.
 *
 * Every crossing is additionally proved with the REAL `findNavigationPath` in BOTH
 * orientations (contract §9), asserting `reached` and that every deck tile lies on
 * the returned path.
 *
 * Usage:  node scripts/measure-nirvana-east-compositions.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");

async function loadModules() {
  const server = await createServer({
    root: FRONTEND_ROOT,
    configFile: path.join(FRONTEND_ROOT, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "warn",
  });
  const scene = await server.ssrLoadModule("/src/qa/nirvanaEastPilot/eastScene.ts");
  const walk = await server.ssrLoadModule("/src/qa/nirvanaEastPilot/eastWalkability.ts");
  const nav = await server.ssrLoadModule("/src/renderer2d/production/navigation/navigation.ts");
  return { server, scene, walk, nav };
}

/** Prove one crossing with the REAL production pathfinder, in ONE direction. */
function proveCrossing(nav, built, crossing, reverse) {
  const grid = { columns: built.columns, rows: built.rows, collision: built.collision };
  const deck = crossing.deck;
  const start = reverse ? deck[deck.length - 1] : deck[0];
  const goal = reverse ? deck[0] : deck[deck.length - 1];
  const abutmentStart = crossing.abutments[reverse ? 1 : 0];
  const abutmentGoal = crossing.abutments[reverse ? 0 : 1];
  const result = nav.findNavigationPath(grid, { start: abutmentStart, goal: abutmentGoal });
  const pathKeys = new Set(result.tiles.map((t) => `${t.column},${t.row}`));
  const allDeckOnPath = deck.every((t) => pathKeys.has(`${t.column},${t.row}`));
  return {
    id: crossing.id,
    direction: reverse ? "reverse" : "forward",
    reached: result.status === "reached",
    allDeckOnPath,
    pathLength: result.tiles.length,
  };
}

export async function measureNirvanaEastCompositions() {
  const { server, scene, walk, nav } = await loadModules();
  try {
    const results = [];
    for (const id of scene.NIRVANA_EAST_COMPOSITION_IDS) {
      try {
        results.push(measureOneComposition(id, scene, walk, nav));
      } catch (error) {
        // One composition's geometry failing to build must never hide the
        // other two compositions' numbers from this report.
        results.push({ composition: id, buildError: `${error.stack ?? error}` });
      }
    }
    return results;
  } finally {
    await server.close();
  }
}

function measureOneComposition(id, scene, walk, nav) {
  {
      const built = scene.createNirvanaEastScene(id);

      const blocked = built.collision.reduce((total, cell) => total + cell, 0);
      const walkable = built.collision.length - blocked;
      const components = scene.walkableComponents(built.collision, built.columns, built.rows, true);
      const plots = walk.shelterPlotReport(built);
      const identity = walk.identityVisibilityReport(built);
      const torus = walk.torusReport(built);
      const landmarks = walk.landmarkAnchorSites(built);

      const crossingsByAxis = { "east-west": 0, "north-south": 0 };
      for (const crossing of built.crossings) crossingsByAxis[crossing.axis] += 1;

      const crossingProofs = [];
      for (const crossing of built.crossings) {
        crossingProofs.push(proveCrossing(nav, built, crossing, false));
        crossingProofs.push(proveCrossing(nav, built, crossing, true));
      }

      const blockedHistogram = {};
      for (const tile of built.tiles) {
        if (!tile.blocked) continue;
        blockedHistogram[tile.material] = (blockedHistogram[tile.material] ?? 0) + 1;
      }

      // Landform footprint accounting: one group per physical placement
      // (the blocking anchor plus its purely-visual wrapped-edge duplicates,
      // if any, all share `landformGroup`), counted per tier from the
      // anchor's own frameId (`s.<tier>.0`).
      const landformGroups = new Map();
      for (const prop of built.props) {
        if (prop.landformGroup === null || prop.landformGroup === undefined) continue;
        if (!landformGroups.has(prop.landformGroup)) landformGroups.set(prop.landformGroup, []);
        landformGroups.get(prop.landformGroup).push(prop);
      }
      const landformsByTier = { mesa: 0, butte: 0, outcrop: 0 };
      let landformFootprintTiles = 0;
      let landformWrapDuplicates = 0;
      for (const group of landformGroups.values()) {
        const anchor = group.find((prop) => prop.blocks) ?? group[0];
        const tier = anchor.frameId.split(".")[1];
        if (landformsByTier[tier] !== undefined) landformsByTier[tier] += 1;
        landformFootprintTiles += anchor.footprint?.length ?? 0;
        landformWrapDuplicates += group.length - 1;
      }

      return {
        composition: id,
        tiles: built.collision.length,
        walkable,
        blocked,
        blockedPercent: Number(((blocked / built.collision.length) * 100).toFixed(1)),
        components: components.length,
        largestComponent: Math.max(...components.map((c) => c.tiles.length)),
        plotsClear: plots.clear,
        plotsLost: plots.lost,
        plotsTotal: plots.total,
        inView: identity.plotsWithIdentityInView,
        medianDistance: identity.medianDistance,
        maxDistance: identity.maxDistance,
        crossingsByAxis,
        crossingCount: built.crossings.length,
        seamMismatchNS: torus.seamMismatchNS,
        seamMismatchEW: torus.seamMismatchEW,
        wrapOpeningsNS: torus.wrapOpeningsNS,
        wrapOpeningsEW: torus.wrapOpeningsEW,
        landmarkAnchorSites: landmarks.length,
        landmarkKinds: landmarks.reduce((acc, site) => {
          acc[site.kind] = (acc[site.kind] ?? 0) + 1;
          return acc;
        }, {}),
        blockedHistogram,
        props: built.props.length,
        landformsByTier,
        landformCount: landformGroups.size,
        landformFootprintTiles,
        landformWrapDuplicates,
        crossingProofs,
      };
  }
}

function printReport(results) {
  for (const r of results) {
    process.stdout.write(`\n=== ${r.composition} ===\n`);
    if (r.buildError !== undefined) {
      process.stdout.write(`BUILD FAILED:\n${r.buildError}\n`);
      continue;
    }
    process.stdout.write(`walkable=${r.walkable} / ${r.tiles}  blocked%=${r.blockedPercent}\n`);
    process.stdout.write(`walkable components (toroidal)=${r.components} (largest=${r.largestComponent})\n`);
    process.stdout.write(`plots clear=${r.plotsClear}/${r.plotsTotal}  LOST=${r.plotsLost}\n`);
    process.stdout.write(`inView=${r.inView}/${r.plotsTotal}  medianDist=${r.medianDistance}  maxDist=${r.maxDistance}\n`);
    process.stdout.write(
      `crossings: east-west=${r.crossingsByAxis["east-west"]} north-south=${r.crossingsByAxis["north-south"]} `
      + `(total ${r.crossingCount})\n`,
    );
    process.stdout.write(`torus seam mismatches: NS=${r.seamMismatchNS} EW=${r.seamMismatchEW} (must be 0)\n`);
    process.stdout.write(`wrapOpeningsNS=${r.wrapOpeningsNS}  wrapOpeningsEW=${r.wrapOpeningsEW} (must be >0, target >=20)\n`);
    process.stdout.write(`landmark anchor sites=${r.landmarkAnchorSites} (must be >=8): ${JSON.stringify(r.landmarkKinds)}\n`);
    process.stdout.write(`props=${r.props}\n`);
    process.stdout.write(
      `landforms=${r.landformCount} ${JSON.stringify(r.landformsByTier)} `
      + `footprintTiles=${r.landformFootprintTiles} wrapDuplicates=${r.landformWrapDuplicates}\n`,
    );
    process.stdout.write(`blocked-material histogram: ${JSON.stringify(r.blockedHistogram)}\n`);
    const failedProofs = r.crossingProofs.filter((p) => !p.reached || !p.allDeckOnPath);
    process.stdout.write(
      `crossing proofs: ${r.crossingProofs.length} (${r.crossingProofs.length - failedProofs.length} ok)\n`,
    );
    for (const proof of failedProofs) {
      process.stdout.write(
        `  FAILED ${proof.id} [${proof.direction}]: reached=${proof.reached} allDeckOnPath=${proof.allDeckOnPath}\n`,
      );
    }
  }

  process.stdout.write("\n=== GATE SUMMARY ===\n");
  let allGreen = true;
  for (const r of results) {
    if (r.buildError !== undefined) {
      allGreen = false;
      process.stdout.write(`${r.composition}: RED (build failed - see error above)\n`);
      continue;
    }
    const gates = [
      ["plotsLost === 0", r.plotsLost === 0],
      ["components === 1", r.components === 1],
      ["seamMismatchNS === 0", r.seamMismatchNS === 0],
      ["seamMismatchEW === 0", r.seamMismatchEW === 0],
      ["wrapOpeningsNS > 0", r.wrapOpeningsNS > 0],
      ["wrapOpeningsEW > 0", r.wrapOpeningsEW > 0],
      ["landmarkAnchorSites >= 8", r.landmarkAnchorSites >= 8],
      ["both crossing axes present", r.crossingsByAxis["east-west"] > 0 && r.crossingsByAxis["north-south"] > 0],
      ["all crossing proofs pass", r.crossingProofs.every((p) => p.reached && p.allDeckOnPath)],
    ];
    const failed = gates.filter(([, ok]) => !ok);
    if (failed.length > 0) allGreen = false;
    process.stdout.write(
      `${r.composition}: ${failed.length === 0 ? "GREEN" : `RED (${failed.map(([name]) => name).join(", ")})`}\n`,
    );
  }
  process.stdout.write(allGreen ? "\nALL GATES GREEN\n" : "\nGATES FAILING - see above\n");
  return allGreen;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  measureNirvanaEastCompositions()
    .then((results) => {
      const allGreen = printReport(results);
      process.exitCode = allGreen ? 0 : 1;
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
