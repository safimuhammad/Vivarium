const { defineConfig } = require('@playwright/test');

const frontendPort = Number(process.env.VIVARIUM_PRODUCTION_PERFORMANCE_PORT || 19186);
const frontendBaseUrl = `http://127.0.0.1:${frontendPort}`;

module.exports = defineConfig({
  testDir: './tests/frontend-app',
  testMatch: /vivarium-2d-production-performance\.spec\.ts/,
  timeout: 150000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: frontendBaseUrl,
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    // Performance certification must not include Playwright trace/screencast overhead.
    // Dedicated diagnostic runs may enable tracing explicitly when investigating a failure.
    trace: 'off',
  },
  webServer: {
    command: `npm --prefix frontend run build && npm --prefix frontend run preview -- --port ${frontendPort} --strictPort`,
    url: frontendBaseUrl,
    reuseExistingServer: false,
    timeout: 60000,
  },
});
