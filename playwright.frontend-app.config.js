const { defineConfig } = require('@playwright/test');

const frontendPort = Number.parseInt(
  process.env.VIVARIUM_FRONTEND_APP_PORT || '5174',
  10,
);
if (!Number.isInteger(frontendPort) || frontendPort < 1 || frontendPort > 65535) {
  throw new Error('VIVARIUM_FRONTEND_APP_PORT must be a valid TCP port.');
}
const frontendUrl = `http://127.0.0.1:${frontendPort}`;

module.exports = defineConfig({
  testDir: './tests/frontend-app',
  timeout: 30000,
  use: {
    baseURL: frontendUrl,
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm --prefix frontend run dev -- --port ${frontendPort} --strictPort`,
    url: frontendUrl,
    reuseExistingServer: true,
    timeout: 15000,
  },
});
