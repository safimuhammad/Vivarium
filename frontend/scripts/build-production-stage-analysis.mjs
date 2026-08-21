import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { build } from "vite";

/** Build an isolated two-entry graph so Vite exposes the exact production Stage closure. */
export async function buildProductionStageAnalysis() {
  const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
  const outputRoot = await mkdtemp(path.join(tmpdir(), "vivarium-stage-analysis-"));
  try {
    await build({
      configFile: false,
      root: frontendRoot,
      logLevel: "silent",
      plugins: [react()],
      build: {
        outDir: outputRoot,
        emptyOutDir: true,
        copyPublicDir: false,
        manifest: true,
        chunkSizeWarningLimit: 900,
        rollupOptions: {
          input: {
            startup: path.join(frontendRoot, "index.html"),
            productionStage: path.join(
              frontendRoot,
              "src/renderer2d/production/PresentationWorldStage.tsx",
            ),
          },
        },
      },
    });
  } catch (error) {
    await rm(outputRoot, { recursive: true, force: true });
    throw error;
  }
  return Object.freeze({
    distDir: outputRoot,
    cleanup: () => rm(outputRoot, { recursive: true, force: true }),
  });
}
