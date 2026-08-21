/** Compose the NEW industrial species at 1:1 on region ground, for eye judging. */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ART = path.resolve("/Users/muhammadsafi/Desktop/software-dev/simulation/scratchpad/nirvana-west-live/art");
const OUT = path.resolve("/Users/muhammadsafi/Desktop/software-dev/simulation/scratchpad/being-sprite-evidence/nirvana-west-live");
const atlas = JSON.parse(await readFile(path.join(ART, "atlas.json"), "utf8"));
const scenery = await sharp(path.join(ART, "scenery.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const terrain = await sharp(path.join(ART, "terrain.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

const want = process.argv[2] ? process.argv[2].split(",") : null;
const frames = atlas.sceneryFrames.filter(([id]) => !want || want.some((w) => id.startsWith(`s.${w}.`)));

// ground: tile the terrain sheet's `slate` base variants (cells for t.slate.*)
const gridCols = atlas.terrainGrid.columns;
const ids = atlas.terrainGrid.ids;
const groundCells = ["slate", "dust", "cinder"].flatMap((m) =>
  Array.from({ length: 8 }, (_, v) => ids.indexOf(`t.${m}.${v}`)).filter((i) => i >= 0));

const PAD = 18;
const COLS = 1600;
let x = PAD, y = PAD, shelf = 0;
const placed = [];
for (const f of frames) {
  const [id, fx, fy, fw, fh, px, py] = f;
  if (x + fw + PAD > COLS) { x = PAD; y += shelf + PAD; shelf = 0; }
  placed.push({ id, fx, fy, fw, fh, px, py, x, y });
  x += fw + PAD; shelf = Math.max(shelf, fh);
}
const H = y + shelf + PAD;
const out = Buffer.alloc(COLS * H * 4);
// paint ground
for (let ty = 0; ty < Math.ceil(H / 32); ty += 1) {
  for (let tx = 0; tx < Math.ceil(COLS / 32); tx += 1) {
    const cell = groundCells[(tx * 7 + ty * 13) % groundCells.length];
    const sx = (cell % gridCols) * 32, sy = Math.floor(cell / gridCols) * 32;
    for (let j = 0; j < 32; j += 1) for (let i = 0; i < 32; i += 1) {
      const dx = tx * 32 + i, dy = ty * 32 + j;
      if (dx >= COLS || dy >= H) continue;
      const s = ((sy + j) * terrain.info.width + (sx + i)) * 4;
      const d = (dy * COLS + dx) * 4;
      out[d] = terrain.data[s]; out[d + 1] = terrain.data[s + 1]; out[d + 2] = terrain.data[s + 2]; out[d + 3] = 255;
    }
  }
}
for (const p of placed) {
  for (let j = 0; j < p.fh; j += 1) for (let i = 0; i < p.fw; i += 1) {
    const s = ((p.fy + j) * scenery.info.width + (p.fx + i)) * 4;
    const a = scenery.data[s + 3];
    if (a === 0) continue;
    const dx = p.x + i, dy = p.y + j;
    if (dx < 0 || dy < 0 || dx >= COLS || dy >= H) continue;
    const d = (dy * COLS + dx) * 4;
    const k = a / 255;
    out[d] = Math.round(scenery.data[s] * k + out[d] * (1 - k));
    out[d + 1] = Math.round(scenery.data[s + 1] * k + out[d + 1] * (1 - k));
    out[d + 2] = Math.round(scenery.data[s + 2] * k + out[d + 2] * (1 - k));
  }
}
const name = process.argv[3] ?? "industrial-species-1to1.png";
await sharp(out, { raw: { width: COLS, height: H, channels: 4 } }).png().toFile(path.join(OUT, name));
process.stdout.write(`${name} ${COLS}x${H}, ${placed.length} frames: ${placed.map((p) => p.id).join(" ")}\n`);
