/** The 4-phase fire loop at 1:1 on real fissure ground, plus a 3x inspection strip. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
const ROOT = "/Users/muhammadsafi/Desktop/software-dev/simulation";
const ART = path.join(ROOT, "scratchpad/nirvana-west-live/art");
const OUT = path.join(ROOT, "scratchpad/being-sprite-evidence/nirvana-west-live");
const atlas = JSON.parse(await readFile(path.join(ART, "atlas.json"), "utf8"));
const env = await sharp(path.join(ART, "environment.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const terrain = await sharp(path.join(ART, "terrain.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const ids = atlas.terrainGrid.ids, gc = atlas.terrainGrid.columns;
const kinds = atlas.environmentGrid.kinds;
const CELL = 32, FRAMES = 4, GRIDC = atlas.environmentGrid.columns;
// A ribbon of ember floor with cinder banks, 20 tiles wide x 5 tall.
const TW = 22, TH = 5, W = TW * 32, H = TH * 32;
const out = Buffer.alloc(W * H * 4);
function h(x, y, s) { const n = Math.sin(x * 12.9898 + y * 78.233 + s) * 43758.5453; return n - Math.floor(n); }
for (let r = 0; r < TH; r += 1) for (let c = 0; c < TW; c += 1) {
  const m = r === 0 || r === TH - 1 ? "cinder" : r === 1 || r === TH - 2 ? "emberdim" : "ember";
  const cell = ids.indexOf(`t.${m}.${Math.floor(h(c, r, 7) * 8)}`);
  const sx = (cell % gc) * 32, sy = Math.floor(cell / gc) * 32;
  for (let j = 0; j < 32; j += 1) for (let i = 0; i < 32; i += 1) {
    const s = ((sy + j) * terrain.info.width + (sx + i)) * 4, d = ((r * 32 + j) * W + c * 32 + i) * 4;
    out[d] = terrain.data[s]; out[d+1] = terrain.data[s+1]; out[d+2] = terrain.data[s+2]; out[d+3] = 255;
  }
}
// Scatter placements with per-placement phase seeds, exactly as production does.
const now = Number(process.argv[2] ?? 0);
const placements = [];
for (let c = 1; c < TW - 1; c += 1) {
  for (const r of [2, 3]) {
    if (h(c, r, 31) > 0.55) continue;
    placements.push({ c, r, kind: h(c, r, 47) > 0.7 ? 1 : 0, seed: Math.floor(h(c, r, 61) * 640) });
  }
}
for (const p of placements) {
  const phase = Math.floor((((now + p.seed) % 640) / 160)) % FRAMES;
  const cell = p.kind * FRAMES + phase;
  const sx = (cell % GRIDC) * CELL, sy = Math.floor(cell / GRIDC) * CELL;
  for (let j = 0; j < CELL; j += 1) for (let i = 0; i < CELL; i += 1) {
    const s = ((sy + j) * env.info.width + (sx + i)) * 4;
    const a = env.data[s + 3]; if (a === 0) continue;
    const dx = p.c * 32 + i, dy = p.r * 32 + j;
    if (dx < 0 || dy < 0 || dx >= W || dy >= H) continue;
    const d = (dy * W + dx) * 4, k = a / 255;
    out[d] = Math.round(env.data[s] * k + out[d] * (1 - k));
    out[d+1] = Math.round(env.data[s+1] * k + out[d+1] * (1 - k));
    out[d+2] = Math.round(env.data[s+2] * k + out[d+2] * (1 - k));
  }
}
const name = process.argv[3] ?? "fire.png";
await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(OUT, name));
process.stdout.write(`${name} ${W}x${H}, ${placements.length} placements, t=${now}ms, kinds=${kinds.join("/")}\n`);
