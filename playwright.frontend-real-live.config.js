const { defineConfig } = require('@playwright/test');
const { resolveRealLiveTimeoutBudget } = require('./tests/frontend-live/real-live-timeout-budget');

const frontendBaseUrl = process.env.VIVARIUM_REAL_LIVE_FRONTEND_URL || 'http://127.0.0.1:1';
const timeoutBudget = resolveRealLiveTimeoutBudget();
const browserChannel = browserChannelOverride(process.env.VIVARIUM_REAL_LIVE_BROWSER_CHANNEL);

module.exports = defineConfig({
  testDir: './tests/frontend-live',
  testMatch: /live-real-provider\.spec\.js/,
  timeout: timeoutBudget.testTimeoutMs,
  expect: {
    timeout: Math.min(timeoutBudget.proofTimeoutMs, 15000),
  },
  use: {
    baseURL: frontendBaseUrl,
    ...(browserChannel ? { channel: browserChannel } : {}),
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
});

function browserChannelOverride(value) {
  const channel = (value || '').trim();
  return channel && channel.toLowerCase() !== 'chromium' ? channel : undefined;
}
