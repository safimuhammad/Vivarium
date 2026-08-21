const { defineConfig } = require('@playwright/test');

const apiPort = Number(process.env.VIVARIUM_BUILT_LIVE_API_PORT || 19031);
const frontendPort = Number(process.env.VIVARIUM_BUILT_LIVE_FRONTEND_PORT || 19185);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const frontendBaseUrl = `http://127.0.0.1:${frontendPort}`;

module.exports = defineConfig({
  testDir: './tests/frontend-live',
  testMatch: /live-built-real-api\.spec\.js/,
  timeout: 60000,
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
