/**
 * Renders `map-scale.png` for the Nirvana East pilot: every composition (plus
 * the current-production baseline) at island size (64 / 140 / 260 px), RAW
 * and CLIPPED by the REAL `dry_scrub` island silhouette, beside the shipped
 * Nirvana and Warm Springs world views for comparison.
 *
 * A sibling of `render-nirvana-east-plates.mjs`, run separately (matching how
 * `render-warm-springs-plates.mjs` itself does not fold map-scale in). Reads
 * the plates that script already wrote (`<id>.png`, plus the standalone
 * baseline `00-nirvana-east-current-baseline.png`) rather than re-rendering.
 *
 * The CLIP is not a hand-rolled ellipse: it is the real production pipeline,
 * unmodified --
 *   `createRegionMapIdentity` / `createRegionMapRecipe` (this region's real
 *     kit, `dry-scrub`, and its real 3072x3072 extent, from `config/world.yaml`)
 *   `computeRegionSheet` (the real ring layout for all 4 regions, from the
 *     real adjacency graph) to get this region's real neighbour directions
 *   `islandFillFraction` (this region's real carrying-capacity fill, against
 *     the real max across all 4 regions)
 *   `buildIslandMask` + `islandMapFit` + `pointInIslandMask` (the exact
 *     functions `CanvasPresentationRenderer.ts`'s `resolveAtlasSheet` /
 *     `ensureAtlasIsland` call to build the ATLAS world view)
 * -- so the clip a viewer judges here is the clip production would actually
 * apply, not an approximation of it.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { createServer } from "vite";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");
const REPO_ROOT = path.resolve(FRONTEND_ROOT, "..");
const PILOT_DIR = path.resolve(REPO_ROOT, "docs/frontend/mockups/regions/nirvana-east-pilot");
const NIRVANA_WORLD_MAP = path.resolve(
  REPO_ROOT, "scratchpad/being-sprite-evidence/nirvana-live/world-map-nirvana.png",
);
const WARM_SPRINGS_WORLD_MAP = path.resolve(
  REPO_ROOT, "scratchpad/being-sprite-evidence/warm-springs-live/world-map-warm-springs.png",
);

const REGION_ID = "nirvana_east";
const RUN_SEED = 1;
const SIZES = [64, 140, 260];

/** Identity materials (contract §9) -- what "the region's signature" means, tile by tile. */
const IDENTITY_MATERIALS = new Set([
  "brine", "brinerim", "salt", "redsand", "oxide", "mesa", "scarp", "slot",
]);

// ---------------------------------------------------------------------------
// raw RGBA surface helpers (mirrors render-nirvana-east-plates.mjs)
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

function downsample(surface, targetWidth) {
  const scale = targetWidth / surface.width;
  const targetHeight = Math.max(1, Math.round(surface.height * scale));
  const out = createSurface(targetWidth, targetHeight);
  for (let row = 0; row < targetHeight; row += 1) {
    const sy0 = Math.floor((row / targetHeight) * surface.height);
    const sy1 = Math.max(sy0 + 1, Math.floor(((row + 1) / targetHeight) * surface.height));
    for (let column = 0; column < targetWidth; column += 1) {
      const sx0 = Math.floor((column / targetWidth) * surface.width);
      const sx1 = Math.max(sx0 + 1, Math.floor(((column + 1) / targetWidth) * surface.width));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const index = (sy * surface.width + sx) * 4;
          r += surface.data[index];
          g += surface.data[index + 1];
          b += surface.data[index + 2];
          a += surface.data[index + 3];
          count += 1;
        }
      }
      const target = (row * targetWidth + column) * 4;
      out.data[target] = r / count;
      out.data[target + 1] = g / count;
      out.data[target + 2] = b / count;
      out.data[target + 3] = a / count;
    }
  }
  return out;
}

function toPngBuffer(surface) {
  return sharp(
    Buffer.from(surface.data.buffer, surface.data.byteOffset, surface.data.length),
    { raw: { width: surface.width, height: surface.height, channels: 4 } },
  ).png().toBuffer();
}

/**
 * Distinct colours + dominant-colour share at 96px, 5-bit quantised per
 * channel. This exact recipe (sharp `resize(96, 96, {fit: "fill"})` then
 * `channel >> 3`) was validated against the contract's own reference numbers
 * before being adopted here: it reproduces "25 colours / 93.5%" for
 * `00-nirvana-east-current-baseline.png` and "579 / 12.1%" for Warm Springs'
 * `b-great-terrace.png` exactly, so it is the intended method, not a guess.
 */
async function colourSignature(pngBuffer) {
  const { data } = await sharp(pngBuffer).resize(96, 96, { fit: "fill" }).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const counts = new Map();
  let total = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const key = ((data[index] >> 3) << 10) | ((data[index + 1] >> 3) << 5) | (data[index + 2] >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
  }
  const dominant = Math.max(...counts.values());
  return {
    distinctColours: counts.size,
    dominantShare: total > 0 ? dominant / total : 0,
    sampledPixels: total,
  };
}

// ---------------------------------------------------------------------------
// config/world.yaml -> RegionSnapshot[] (mirrors render-nirvana-east-baseline.mjs)
// ---------------------------------------------------------------------------

function parseWorldYamlRegions(yamlText) {
  const sectionMatch = yamlText.match(/^regions:\n([\s\S]*?)\nagents:/m);
  if (!sectionMatch) throw new Error("config/world.yaml: could not find a `regions:` section.");
  const blocks = sectionMatch[1]
    .split(/\n(?=\s{2}- name:)/)
    .map((block) => block.trim())
    .filter(Boolean);
  return blocks.map((block) => {
    const fields = {};
    for (const rawLine of block.split("\n")) {
      const line = rawLine.trim();
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      const key = line.slice(0, colon).replace(/^-\s*/, "").trim();
      const value = line.slice(colon + 1).trim();
      fields[key] = value;
    }
    const unquote = (value) => value.replace(/^"|"$/g, "");
    return {
      name: unquote(fields.name),
      description: unquote(fields.description),
      connections: JSON.parse(fields.connections),
      energy_rate: Number(fields.energy_rate),
      materials_rate: Number(fields.materials_rate),
      current_energy: Number(fields.current_energy),
      current_materials: Number(fields.current_materials),
      max_energy: Number(fields.max_energy),
      max_materials: Number(fields.max_materials),
    };
  });
}

// ---------------------------------------------------------------------------
// composite sheet
// ---------------------------------------------------------------------------

function labelSvg(width, height, text, fontSize = 13) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return Buffer.from(
    `<svg width="${width}" height="${height}">`
    + `<text x="4" y="${Math.round(height / 2) + 4}" font-family="Helvetica,Arial,sans-serif" `
    + `font-size="${fontSize}" fill="#e6e2d8">${escaped}</text></svg>`,
  );
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

export async function renderNirvanaEastMapScale(outputRoot = PILOT_DIR) {
  const server = await createServer({
    root: FRONTEND_ROOT,
    configFile: path.join(FRONTEND_ROOT, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "warn",
  });
  try {
    const identityModule = await server.ssrLoadModule(
      "/src/renderer2d/production/maps/RegionMapIdentity.ts",
    );
    const recipeModule = await server.ssrLoadModule(
      "/src/renderer2d/production/maps/RegionMapRecipe.ts",
    );
    const layoutModule = await server.ssrLoadModule(
      "/src/renderer2d/production/world/regionSheetLayout.ts",
    );
    const islandModule = await server.ssrLoadModule(
      "/src/renderer2d/production/world/islandMask.ts",
    );
    const regionMapModule = await server.ssrLoadModule("/src/renderer2d/map/regionMap.ts");
    const sceneModule = await server.ssrLoadModule("/src/qa/nirvanaEastPilot/eastScene.ts");
    const TILE_SIZE = regionMapModule.TILE_SIZE;

    // --- real production geometry for all 4 regions ------------------------
    const yamlText = await readFile(path.join(REPO_ROOT, "config/world.yaml"), "utf8");
    const regions = parseWorldYamlRegions(yamlText);
    const extents = [];
    const capacities = {};
    const kits = {};
    for (const region of regions) {
      const identity = identityModule.createRegionMapIdentity(RUN_SEED, region, regions);
      const recipe = recipeModule.createRegionMapRecipe(identity);
      extents.push({
        id: region.name,
        widthPx: recipe.grid.columns * TILE_SIZE,
        heightPx: recipe.grid.rows * TILE_SIZE,
      });
      capacities[region.name] = region.max_energy + region.max_materials;
      kits[region.name] = recipe.kit;
    }
    const adjacency = regions.flatMap((region) => region.connections.map((other) => [region.name, other]));
    const sheet = layoutModule.computeRegionSheet(extents, adjacency);
    const maxCapacity = Math.max(...Object.values(capacities));
    const neighboursOf = (id) => [...new Set(
      adjacency.filter(([a, b]) => a === id || b === id).map(([a, b]) => (a === id ? b : a)),
    )].sort();
    const centerOf = (id) => {
      const rect = sheet.rects[id];
      return rect === undefined ? null : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    };
    const capeAnglesOf = (id) => {
      const self = centerOf(id);
      if (self === null) return [];
      return neighboursOf(id).flatMap((other) => {
        const point = centerOf(other);
        return point === null ? [] : [Math.atan2(point.y - self.y, point.x - self.x)];
      });
    };

    const eastExtent = extents.find((extent) => extent.id === REGION_ID);
    const eastFill = islandModule.islandFillFraction(capacities[REGION_ID], maxCapacity);
    const eastCapeAngles = capeAnglesOf(REGION_ID);
    const mask = islandModule.buildIslandMask({
      regionId: REGION_ID,
      kit: kits[REGION_ID],
      widthPx: eastExtent.widthPx,
      heightPx: eastExtent.heightPx,
      capeAngles: eastCapeAngles,
      fill: eastFill,
    });
    const fit = islandModule.islandMapFit(mask, eastExtent.widthPx, eastExtent.heightPx);
    const landBox = islandModule.islandLandBox(mask);
    const landCells = mask.land.reduce((total, cell) => total + cell, 0);
    const landPct = (100 * landCells) / mask.land.length;
    // `islandMapFit` falls back to the uniform COVER placement whenever no inset rect passes
    // `MAP_FIT_MIN_SPAN`; comparing the returned fit against that same cover computation (done
    // the identical way `islandMapFit` itself does it) is how the report below states plainly
    // whether this composition got an inset fit or the cover fallback.
    const coverScale = Math.max(landBox.width / eastExtent.widthPx, landBox.height / eastExtent.heightPx);

    function marginOnLandFraction() {
      const band = Math.max(1, Math.round(Math.min(fit.width, fit.height) * 0.1));
      const x0 = fit.x;
      const y0 = fit.y;
      const x1 = fit.x + fit.width;
      const y1 = fit.y + fit.height;
      let bandLand = 0;
      let bandTotal = 0;
      const step = mask.cell;
      for (let py = y0; py < y1; py += step) {
        for (let px = x0; px < x1; px += step) {
          const inInner = px >= x0 + band && px < x1 - band && py >= y0 + band && py < y1 - band;
          if (inInner) continue;
          bandTotal += 1;
          if (islandModule.pointInIslandMask(mask, px, py)) bandLand += 1;
        }
      }
      return bandTotal > 0 ? bandLand / bandTotal : 1;
    }

    /** Project the full 3072x3072 plate into `fit`, clipped by the island mask. */
    function projectAndClip(plate) {
      const canvas = createSurface(plate.width, plate.height);
      const stepX = plate.width / fit.width;
      const stepY = plate.height / fit.height;
      for (let y = 0; y < fit.height; y += 1) {
        const destY = Math.round(fit.y + y);
        if (destY < 0 || destY >= canvas.height) continue;
        const srcY = Math.min(plate.height - 1, Math.floor(y * stepY));
        for (let x = 0; x < fit.width; x += 1) {
          const destX = Math.round(fit.x + x);
          if (destX < 0 || destX >= canvas.width) continue;
          if (!islandModule.pointInIslandMask(mask, destX, destY)) continue;
          const srcX = Math.min(plate.width - 1, Math.floor(x * stepX));
          const s = (srcY * plate.width + srcX) * 4;
          const d = (destY * canvas.width + destX) * 4;
          canvas.data[d] = plate.data[s];
          canvas.data[d + 1] = plate.data[s + 1];
          canvas.data[d + 2] = plate.data[s + 2];
          canvas.data[d + 3] = 255;
        }
      }
      return canvas;
    }

    /** Fraction of `tiles` (each `{column, row}` in the ORIGINAL 96x96 plate grid) whose
     * projected position under `fit` survives the island clip. */
    function tileSurvivalFraction(tiles) {
      if (tiles.length === 0) return null;
      let survive = 0;
      for (const tile of tiles) {
        const px = fit.x + ((tile.column + 0.5) * TILE_SIZE / eastExtent.widthPx) * fit.width;
        const py = fit.y + ((tile.row + 0.5) * TILE_SIZE / eastExtent.heightPx) * fit.height;
        if (islandModule.pointInIslandMask(mask, px, py)) survive += 1;
      }
      return survive / tiles.length;
    }

    const allTiles = [];
    for (let row = 0; row < 96; row += 1) {
      for (let column = 0; column < 96; column += 1) allTiles.push({ column, row });
    }
    const marginOnLand = marginOnLandFraction();
    const overallTileSurvival = tileSurvivalFraction(allTiles);

    // --- per-composition entries --------------------------------------------
    const entries = [
      { id: "00-nirvana-east-current-baseline", label: "before (production today)", isComposition: false },
      { id: "a-arroyo-braid", label: "A — Dry Wash Country", isComposition: true },
      { id: "b-mesa-field", label: "B — Butte Country", isComposition: true },
      { id: "c-salt-pan", label: "C — The Striped Pan", isComposition: true },
    ];

    const results = [];
    const thumbnails = {};
    for (const entry of entries) {
      const plateFile = path.join(outputRoot, `${entry.id}.png`);
      const plate = await loadSurface(plateFile);
      const projected = projectAndClip(plate);
      const raw = {};
      const clipped = {};
      for (const size of SIZES) {
        raw[size] = downsample(plate, size);
        clipped[size] = downsample(projected, size);
      }
      thumbnails[entry.id] = { raw, clipped };

      const colour = await colourSignature(await toPngBuffer(plate));

      let identitySurvival = null;
      if (entry.isComposition) {
        const scene = sceneModule.createNirvanaEastScene(entry.id);
        const identityTiles = scene.tiles
          .filter((tile) => IDENTITY_MATERIALS.has(tile.material))
          .map((tile) => ({ column: tile.column, row: tile.row }));
        identitySurvival = {
          identityTileCount: identityTiles.length,
          identityTileSharePctOfPlate: Number(
            (100 * identityTiles.length / scene.tiles.length).toFixed(2),
          ),
          survivalFraction: tileSurvivalFraction(identityTiles),
        };
      }

      results.push({
        id: entry.id,
        label: entry.label,
        colour,
        identitySurvival,
      });
    }

    // --- shipped Nirvana / Warm Springs reference columns -------------------
    const shippedColumns = [];
    for (const [id, label, file] of [
      ["nirvana-shipped", "shipped Nirvana (worn-heartland)", NIRVANA_WORLD_MAP],
      ["warm-springs-shipped", "shipped Warm Springs (spring-terraces)", WARM_SPRINGS_WORLD_MAP],
    ]) {
      try {
        const surface = await loadSurface(file);
        const sized = {};
        for (const size of SIZES) sized[size] = downsample(surface, size);
        thumbnails[id] = { raw: sized, clipped: sized };
        shippedColumns.push({ id, label, ok: true });
      } catch {
        shippedColumns.push({ id, label, ok: false });
      }
    }

    // --- compose the sheet ---------------------------------------------------
    const columns = [
      ...entries.map((entry) => ({ id: entry.id, label: entry.label })),
      ...shippedColumns.filter((column) => column.ok).map(({ id, label }) => ({ id, label })),
    ];
    const rowSpecs = SIZES.flatMap((size) => [
      { key: `raw-${size}`, size, mode: "raw", label: `raw ${size}px` },
      { key: `clipped-${size}`, size, mode: "clipped", label: `clipped ${size}px` },
    ]);

    const colWidth = Math.max(...SIZES) + 16;
    const rowLabelWidth = 90;
    const colLabelHeight = 46;
    const rowLabelHeightEach = Math.max(...SIZES) + 16;
    const width = rowLabelWidth + columns.length * colWidth;
    const height = colLabelHeight + rowSpecs.length * rowLabelHeightEach;

    const composite = [];
    for (const [columnIndex, column] of columns.entries()) {
      composite.push({
        input: labelSvg(colWidth, colLabelHeight, column.label, 12),
        left: rowLabelWidth + columnIndex * colWidth,
        top: 0,
      });
    }
    for (const [rowIndex, rowSpec] of rowSpecs.entries()) {
      const rowTop = colLabelHeight + rowIndex * rowLabelHeightEach;
      composite.push({
        input: labelSvg(rowLabelWidth, rowLabelHeightEach, rowSpec.label, 12), left: 0, top: rowTop,
      });
      for (const [columnIndex, column] of columns.entries()) {
        const thumb = thumbnails[column.id]?.[rowSpec.mode]?.[rowSpec.size];
        if (thumb === undefined) continue;
        const left = rowLabelWidth + columnIndex * colWidth + Math.round((colWidth - thumb.width) / 2);
        const top = rowTop + Math.round((rowLabelHeightEach - thumb.height) / 2);
        composite.push({ input: await toPngBuffer(thumb), left, top });
      }
    }

    const png = await sharp({
      create: { width, height, channels: 4, background: { r: 12, g: 14, b: 13, alpha: 1 } },
    }).composite(composite).png({ compressionLevel: 9 }).toBuffer();
    const outputFile = path.join(outputRoot, "map-scale.png");
    await writeFile(outputFile, png);

    const summary = {
      outputFile,
      width,
      height,
      island: {
        kit: kits[REGION_ID],
        widthPx: eastExtent.widthPx,
        heightPx: eastExtent.heightPx,
        capeAngles: eastCapeAngles,
        fill: eastFill,
        landCells,
        totalCells: mask.land.length,
        landPct: Number(landPct.toFixed(2)),
        fitRect: fit,
        fitIsCoverFallback: Math.abs(fit.width - eastExtent.widthPx * coverScale) < 1
          && Math.abs(fit.height - eastExtent.heightPx * coverScale) < 1,
        marginOnLandPct: Number((100 * marginOnLand).toFixed(1)),
        overallTileSurvivalPct: Number((100 * overallTileSurvival).toFixed(1)),
        siblingCapacities: capacities,
        siblingKits: kits,
      },
      compositions: results,
      shippedColumns,
    };
    await writeFile(
      path.join(outputRoot, "map-scale-summary.json"),
      JSON.stringify(summary, null, 1),
    );
    return summary;
  } finally {
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf("--out");
  renderNirvanaEastMapScale(outIndex > 0 ? path.resolve(process.argv[outIndex + 1]) : PILOT_DIR)
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 1)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
