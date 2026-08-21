const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/frontend',
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:8911',
    channel: 'chrome',
    viewport: { width: 1680, height: 945 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'python3 -m http.server 8911',
    url: 'http://127.0.0.1:8911/docs/frontend/mockups/v4-threejs-world.html',
    reuseExistingServer: true,
    timeout: 15000,
  },
});
