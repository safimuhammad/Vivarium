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
  // cost tracks how fast the machine can produce frames.
  //
  // 30 minutes, derived from the runner itself. The previous 300000 killed run
  // 32539372177 partway through, and the error it printed reads like an app bug
  // but is not one:
  //
  //     expect(locator).toHaveAttribute('data-event-detail-text') failed
  //     Expected: "Mae turns away"   Received: ""
  //
  // Nothing ever rendered an empty attribute. Playwright's text matcher does
  // `receivedString = receivedValue || ""` (matchers/expect.js), so `Received: ""`
  // is what it prints whenever the expect never obtained a value at all -- and
  // that run's call log stops at `waiting for locator(...)` with no
  // `locator resolved to ...` line, above a `Test timeout of 300000ms exceeded`
  // banner. The budget fired while that expect was still on its first poll. Had
  // the attribute genuinely been empty for its own 10s, the failure would have
  // been an ordinary assertion error with no timeout banner.
  //
  // Derivation, anchoring two runner failures against the same points locally
  // (page.goto -> browserContext.close is 12.6s here; `2 passed (26.9s)`):
  //   * run 32536793651 was still in selectMechanicsRegion 217s after the test
  //     started; locally that point is 3.60s in ................. ~60x
  //   * run 32539372177 was inside the first region-trail summary assertion when
  //     300000 fired, so >=299s; locally that point is 3.88s in .. ~77x
  //   * 12.6s x 60-77x projects a full run of 755-971s on the runner, and the
  //     work after that anchor is the selection-heavy part, so the top of that
  //     range is the honest estimate.
  // 1800000 is ~1.9x that, which absorbs the run-to-run variance of a shared
  // runner.
  //
  // Why the runner is that much slower: it rasterises WebGL in software with no
  // GPU. Reproduced locally by launching the same Chrome with
  // `--use-angle=swiftshader`, which takes this app from 113fps to 5fps; every
  // frame-paced wait in the spec stretches with it (the renderer-summary wait
  // goes from under 1s to 45s). CPU throttling does not model this -- it slows
  // JS while leaving the rAF interval alone. Do not add `--disable-gpu` when
  // reproducing: that kills the GPU process outright, the world never reaches
  // `isReady`, and the runner does no such thing.
  //
  // A budget only costs time when something is genuinely stuck, so headroom here
  // is free on a green run.
  timeout: 1800000,
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
