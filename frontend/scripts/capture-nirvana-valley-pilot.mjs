/**
 * Captures the Nirvana valley pilot from a REAL browser canvas.
 *
 * Why this exists: `render-nirvana-valley-pilot.mjs` executes the production
 * draw plan against a hand-written `drawImage` backend, because Node has no
 * canvas. That is fine for iteration, but the claim "rendered with the real
 * tile pipeline" deserves a real `CanvasRenderingContext2D`. This script loads
 * the same pilot modules through the Vite dev server, calls the same
 * `createValleyPaintPlan` / `renderValleyPlan`, and draws into an actual
 * `HTMLCanvasElement` in Chromium at 1:1, then writes the PNG out.
 *
 * It serves its own page from a scratch middleware, so `vite.config.ts` and the
 * production build inputs are untouched and `check:bundle` is unaffected.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { createServer } from "vite";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");
const REPO_ROOT = path.resolve(FRONTEND_ROOT, "..");
const DEFAULT_OUTPUT = path.resolve(
  REPO_ROOT,
  "docs/frontend/mockups/regions/nirvana-pilot",
);

const CAPTURE_ROUTE = "/__valley-capture";

const PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>valley capture</title>
<style>html,body{margin:0;background:#000}canvas{display:block;image-rendering:pixelated}</style>
</head><body>
<script type="module">
import { createValleyScene } from "/src/qa/nirvanaValleyPilot/valleyScene.ts";
import { createValleyPaintPlan, renderValleyPlan }
  from "/src/qa/nirvanaValleyPilot/valleyPainter.ts";
import manifest from "/src/qa/nirvanaValleyPilot/assets/atlas.json";
import terrainUrl from "/src/qa/nirvanaValleyPilot/assets/terrain.png?url";
import sceneryUrl from "/src/qa/nirvanaValleyPilot/assets/scenery.png?url";

function load(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("failed to load " + src));
    image.src = src;
  });
}

(async () => {
  const scene = createValleyScene();
  const plan = createValleyPaintPlan(scene, manifest);
  const [terrain, scenery] = await Promise.all([load(terrainUrl), load(sceneryUrl)]);
  const canvas = document.createElement("canvas");
  canvas.width = scene.widthPixels;
  canvas.height = scene.heightPixels;
  document.body.append(canvas);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2d context");
  renderValleyPlan(context, plan, { terrain, scenery });
  window.__valleyCapture = {
    dataUrl: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
    operations: plan.operations.length,
    blocked: scene.collision.reduce((total, cell) => total + cell, 0),
  };
})().catch((error) => {
  window.__valleyCaptureError = String(error && error.stack ? error.stack : error);
});
</script>
</body></html>`;

export async function captureNirvanaValleyPilot(outputRoot = DEFAULT_OUTPUT) {
  const server = await createServer({
    root: FRONTEND_ROOT,
    configFile: path.join(FRONTEND_ROOT, "vite.config.ts"),
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    logLevel: "warn",
    // Registered inside `configureServer` so it runs BEFORE Vite's own HTML
    // fallback, which otherwise answers this route with the app shell.
    plugins: [{
      name: "valley-capture-route",
      configureServer(devServer) {
        devServer.middlewares.use(CAPTURE_ROUTE, async (_request, response) => {
          const html = await devServer.transformIndexHtml(CAPTURE_ROUTE, PAGE_HTML);
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(html);
        });
      },
    }],
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === "string") {
    await server.close();
    throw new Error("Vite dev server did not report a port");
  }
  const url = `http://127.0.0.1:${address.port}${CAPTURE_ROUTE}`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    const consoleErrors = [];
    page.on("pageerror", (error) => consoleErrors.push(String(error)));
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(
      () => window.__valleyCapture !== undefined || window.__valleyCaptureError !== undefined,
      undefined,
      { timeout: 120_000 },
    );
    const failure = await page.evaluate(() => window.__valleyCaptureError);
    if (failure !== undefined && failure !== null) {
      throw new Error(`browser capture failed: ${failure}`);
    }
    const capture = await page.evaluate(() => window.__valleyCapture);
    const png = Buffer.from(capture.dataUrl.split(",")[1], "base64");
    await mkdir(outputRoot, { recursive: true });
    const file = path.join(outputRoot, "valley-browser-canvas.png");
    await writeFile(file, png);
    return {
      file,
      width: capture.width,
      height: capture.height,
      operations: capture.operations,
      blockedTiles: capture.blocked,
      bytes: png.length,
      pageErrors: consoleErrors,
    };
  } finally {
    await browser.close();
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf("--out");
  const outputRoot = outIndex > 0 ? path.resolve(process.argv[outIndex + 1]) : DEFAULT_OUTPUT;
  captureNirvanaValleyPilot(outputRoot)
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 1)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
