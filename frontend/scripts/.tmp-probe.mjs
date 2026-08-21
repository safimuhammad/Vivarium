import { createServer } from "vite";
import path from "node:path";
const server = await createServer({ root: process.cwd(), configFile: path.resolve("vite.config.ts"), server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const m = await server.ssrLoadModule("/src/qa/nirvanaValleyPilot/valleyScene.ts");
const scene = m.createValleyScene();
const at = (c, r) => scene.tiles[r * scene.columns + c];
for (const bridge of scene.bridges) {
  const parts = bridge.deck.map((t) => `${t.column},${t.row}:${at(t.column, t.row).base}/${at(t.column, t.row).deckOver}`);
  process.stdout.write(`${bridge.id} ${bridge.axis}\n  ${parts.join("  ")}\n`);
}
// candidate north-south lines near the side channel
for (const line of [19, 20, 21, 22, 23]) {
  const runs = [];
  let run = [];
  for (let r = 4; r < 18; r += 1) {
    const t = at(line, r);
    if (t.blocked) run.push(`${r}:${t.base}`);
    else { if (run.length) runs.push(run.join(",")); run = []; }
  }
  if (run.length) runs.push(run.join(","));
  process.stdout.write(`col ${line}: ${runs.join(" | ")}\n`);
}
await server.close();
