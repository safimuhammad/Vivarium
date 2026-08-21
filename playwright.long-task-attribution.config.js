const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/frontend-app',
  testMatch: /long-task-attribution\.spec\.ts/,
  timeout: 10_000,
  workers: 1,
  use: {
    channel: 'chrome',
    trace: 'off',
  },
});
