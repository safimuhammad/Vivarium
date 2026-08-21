import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VIVARIUM_");
  const apiTarget = env.VIVARIUM_API_TARGET || "http://127.0.0.1:8000";
  const apiProxy = {
    "/api": {
      target: apiTarget,
      changeOrigin: true,
      proxyTimeout: 0,
    },
  };

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: apiProxy,
    },
    preview: {
      proxy: apiProxy,
    },
    build: {
      manifest: true,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        input: {
          index: fileURLToPath(new URL("./index.html", import.meta.url)),
          nirvana: fileURLToPath(new URL("./nirvana.html", import.meta.url)),
        },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      css: true,
      exclude: [...configDefaults.exclude, "scripts/**/*.test.mjs"],
    },
  };
});
