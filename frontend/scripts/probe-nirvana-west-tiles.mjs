/**
 * Crops named terrain frames out of the published `nirvana-west-v1` sheet into a
 * labelled contact strip, so material choices can be judged by eye rather than by
 * name. Read-only; publishes nothing.
 *
 * Usage: `node scripts/probe-nirvana-west-tiles.mjs <out.png> <frameId...>`
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");
const ASSET_ROOT = path.join(FRONTEND_ROOT, "src/assets/renderer2d/regions/nirvana-west-v1");

const [outFile, ...frameIds] = process.argv.slice(2);
if (outFile === undefined || frameIds.length === 0) {
  throw new Error("usage: probe-nirvana-west-tiles.mjs <out.png> <frameId...>");
}

const atlas = JSON.parse(fs.readFileSync(path.join(ASSET_ROOT, "atlas.json"), "utf8"));
const grid = atlas.terrainGrid;
const index = new Map(grid.ids.map((id, i) => [id, i]));

const SCALE = 6;
const cell = grid.cell;
const perRow = 16;
const rows = Math.ceil(frameIds.length / perRow);
const width = perRow * cell * SCALE;
const height = rows * cell * SCALE;

const terrain = await sharp(path.join(ASSET_ROOT, "terrain.png")).ensureAlpha().raw()
  .toBuffer({ resolveWithObject: true });
const src = terrain.data;
const srcW = terrain.info.width;

const out = Buffer.alloc(width * height * 4, 0);
frameIds.forEach((id, n) => {
  const i = index.get(id);
  if (i === undefined) throw new Error(`no terrain frame ${id}`);
  const sx = (i % grid.columns) * cell;
  const sy = Math.floor(i / grid.columns) * cell;
  const dx = (n % perRow) * cell * SCALE;
  const dy = Math.floor(n / perRow) * cell * SCALE;
  for (let y = 0; y < cell * SCALE; y += 1) {
    for (let x = 0; x < cell * SCALE; x += 1) {
      const s = ((sy + Math.floor(y / SCALE)) * srcW + sx + Math.floor(x / SCALE)) * 4;
      const d = ((dy + y) * width + dx + x) * 4;
      out[d] = src[s];
      out[d + 1] = src[s + 1];
      out[d + 2] = src[s + 2];
      out[d + 3] = src[s + 3];
    }
  }
});

await sharp(out, { raw: { width, height, channels: 4 } }).png().toFile(outFile);
console.log(`${outFile} ${width}x${height} — ${frameIds.join(" ")}`);
