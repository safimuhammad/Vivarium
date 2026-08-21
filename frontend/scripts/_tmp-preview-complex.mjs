/** Mock the authored INDUSTRIAL COMPLEX at 1:1 on real region ground. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = "/Users/muhammadsafi/Desktop/software-dev/simulation";
const ART = path.join(ROOT, "scratchpad/nirvana-west-live/art");
const OUT = path.join(ROOT, "scratchpad/being-sprite-evidence/nirvana-west-live");
const atlas = JSON.parse(await readFile(path.join(ART, "atlas.json"), "utf8"));
const scenery = await sharp(path.join(ART, "scenery.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const terrain = await sharp(path.join(ART, "terrain.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const F = new Map(atlas.sceneryFrames.map((f) => [f[0], f]));
const gridCols = atlas.terrainGrid.columns;
const ids = atlas.terrainGrid.ids;

const W = 1408, H = 736;
const out = Buffer.alloc(W * H * 4);
// Ground: a believable plain — mostly slate/dust with cinder patches, no checkerboard.
function h2(x, y, s) { const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return n - Math.floor(n); }
for (let ty = 0; ty < Math.ceil(H / 32); ty += 1) {
  for (let tx = 0; tx < Math.ceil(W / 32); tx += 1) {
    const smooth = (fx, fy, sd) => {
      const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      const s0 = h2(x0, y0, sd), s1 = h2(x0 + 1, y0, sd);
      const s2 = h2(x0, y0 + 1, sd), s3 = h2(x0 + 1, y0 + 1, sd);
      const ex = ax * ax * (3 - 2 * ax), ey = ay * ay * (3 - 2 * ay);
      return (s0 * (1 - ex) + s1 * ex) * (1 - ey) + (s2 * (1 - ex) + s3 * ex) * ey;
    };
    const n = smooth(tx / 9, ty / 9, 3) * 0.62 + smooth(tx / 3.5, ty / 3.5, 9) * 0.38;
    const m = n < 0.34 ? "cinder" : n < 0.52 ? "slatedark" : n < 0.74 ? "slate" : "dust";
    const cell = ids.indexOf(`t.${m}.${Math.floor(h2(tx, ty, 5) * 8)}`);
    const sx = (cell % gridCols) * 32, sy = Math.floor(cell / gridCols) * 32;
    for (let j = 0; j < 32; j += 1) for (let i = 0; i < 32; i += 1) {
      const dx = tx * 32 + i, dy = ty * 32 + j;
      if (dx >= W || dy >= H) continue;
      const s = ((sy + j) * terrain.info.width + (sx + i)) * 4, d = (dy * W + dx) * 4;
      out[d] = terrain.data[s]; out[d + 1] = terrain.data[s + 1]; out[d + 2] = terrain.data[s + 2]; out[d + 3] = 255;
    }
  }
}
function draw(id, footX, footY) {
  const f = F.get(id);
  if (!f) throw new Error(`missing ${id}`);
  const [, fx, fy, fw, fh, px, py] = f;
  const ox = footX - px, oy = footY - py;
  for (let j = 0; j < fh; j += 1) for (let i = 0; i < fw; i += 1) {
    const s = ((fy + j) * scenery.info.width + (fx + i)) * 4;
    const a = scenery.data[s + 3];
    if (a === 0) continue;
    const dx = ox + i, dy = oy + j;
    if (dx < 0 || dy < 0 || dx >= W || dy >= H) continue;
    const d = (dy * W + dx) * 4, k = a / 255;
    out[d] = Math.round(scenery.data[s] * k + out[d] * (1 - k));
    out[d + 1] = Math.round(scenery.data[s + 1] * k + out[d + 1] * (1 - k));
    out[d + 2] = Math.round(scenery.data[s + 2] * k + out[d + 2] * (1 - k));
  }
}
const T = 32;
// ---- ground evidence first (flat, drawn under everything) -----------------
for (const [c, r, v] of [[6, 12, 0], [12, 13, 1], [17, 12, 0], [24, 14, 1], [30, 12, 0]]) draw(`s.apron.${v}`, c * T + 16, r * T + 28);
for (const [c, r, v] of [[8, 16, 0], [13, 17, 1], [19, 16, 2], [26, 17, 0], [31, 16, 1], [10, 19, 2]]) draw(`s.slab.${v}`, c * T + 16, r * T + 28);
for (const [c, r, v] of [[11, 15, 0], [21, 18, 1], [28, 15, 2], [15, 19, 0]]) draw(`s.spill.${v}`, c * T + 16, r * T + 28);
// ---- rail spur running the length of the complex --------------------------
for (let c = 3; c <= 40; c += 1) draw("s.railspur.0", c * T + 16, 21 * T + 16);
// ---- the perimeter fence: south run, then a corner and a north-south leg ---
for (let c = 3; c <= 38; c += 1) draw("s.fence.0", c * T + 16, 22 * T + 28);
draw("s.fence.2", 39 * T + 16, 22 * T + 28);
for (let r = 12; r <= 21; r += 1) draw("s.fence.1", 40 * T + 16, r * T + 28);
// ---- the plant itself: relationships, not a scatter -----------------------
draw("s.powerhall.0", 6 * T, 13 * T + 20);          // THE dominant structure
draw("s.coolingtower.0", 17 * T, 12 * T + 24);
draw("s.coolingtower.1", 21 * T + 8, 11 * T + 20);
draw("s.reactorhusk.0", 26 * T, 12 * T + 24);
draw("s.stack.0", 15 * T, 9 * T + 16);
draw("s.stack.2", 31 * T, 10 * T + 20);
draw("s.tankfarm.0", 33 * T, 15 * T + 24);
draw("s.gantry.1", 12 * T, 17 * T + 20);
draw("s.pylon.0", 3 * T, 8 * T + 20);
draw("s.pylon.1", 8 * T, 7 * T + 16);
draw("s.pylon.0", 13 * T, 6 * T + 12);
// ---- connective tissue: a pipeline run leaving the tank farm --------------
for (let c = 4; c <= 30; c += 1) draw(`s.pipeline.${c % 4 === 0 ? 1 : 0}`, c * T + 16, 20 * T + 26);
draw("s.pipeline.3", 31 * T + 16, 20 * T + 26);
for (let r = 5; r <= 11; r += 1) draw("s.pipeline.2", 24 * T + 16, r * T + 26);
// ---- ground evidence outside the fence ------------------------------------
draw("s.tailings.0", 42 * T, 17 * T + 24);
draw("s.tailings.1", 41 * T, 19 * T + 20);
await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png()
  .toFile(path.join(OUT, "industrial-complex-1to1.png"));
process.stdout.write(`industrial-complex-1to1.png ${W}x${H}\n`);
