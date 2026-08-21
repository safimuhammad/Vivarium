/**
 * TEMPORARY EXPERIMENT CONFIG -- keeps the live-replay probe out of the default
 * `vitest run` sweep. Run explicitly:
 *   npx vitest run --config src/qa/liveReplayProbe/vitest.probe.config.ts
 */
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/qa/liveReplayProbe/**/*.probe.ts"],
    testTimeout: 900_000,
    hookTimeout: 900_000,
  },
});
