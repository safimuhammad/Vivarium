const { defineConfig } = require('@playwright/test');

const apiPort = Number(process.env.VIVARIUM_BUILT_LIVE_API_PORT || 19031);
const frontendPort = Number(process.env.VIVARIUM_BUILT_LIVE_FRONTEND_PORT || 19185);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const frontendBaseUrl = `http://127.0.0.1:${frontendPort}`;

module.exports = defineConfig({
  testDir: './tests/frontend-live',
  testMatch: /live-built-real-api\.spec\.js/,
  // Wall-clock budget for the whole test, not a bound on any assertion -- every
  // individual wait below still has its own (unchanged) limit. This smoke drives
  // a full three.js world, a live SSE stream and a real mechanics burst, so its
  // cost tracks how fast the machine can produce frames. Measured end-to-end on
  // a dev Mac with the browser CPU throttled to emulate a slow runner: 11.5s at
  // 1x, 18.3s at 6x, 41.2s at 12x, 81.8s at 20x, 140.4s at 30x -- everything
  // passing, nothing hanging, no individual wait running out. A CI runner
  // rasterising WebGL in software (no GPU) sits well past the 60s this used to
  // allow, which is why it died mid-preamble there while passing locally. 5
  // minutes covers roughly a 60x-slower machine; a budget only costs time when
  // something is genuinely stuck, so headroom here is free on a green run.
  timeout: 300000,
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: frontendBaseUrl,
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `python3 -m tests.frontend_live.live_api_server --host 127.0.0.1 --port ${apiPort}`,
      url: `${apiBaseUrl}/api/run`,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: `npm run build:frontend && npm --prefix frontend run preview -- --port ${frontendPort} --strictPort`,
      url: frontendBaseUrl,
      reuseExistingServer: false,
      timeout: 45000,
      env: {
        VIVARIUM_API_TARGET: apiBaseUrl,
      },
    },
  ],
});
