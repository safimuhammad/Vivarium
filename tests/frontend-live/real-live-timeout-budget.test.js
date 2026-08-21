const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_REAL_LIVE_DIAGNOSTIC_GRACE_MS,
  DEFAULT_REAL_LIVE_TIMEOUT_MS,
  REAL_LIVE_SEQUENTIAL_WAIT_COUNT,
  resolveRealLiveTimeoutBudget,
} = require('./real-live-timeout-budget');

test('real live timeout budget keeps proof timeout separate from diagnostic grace', () => {
  assert.deepEqual(resolveRealLiveTimeoutBudget({
    VIVARIUM_REAL_LIVE_TIMEOUT_MS: '120000',
    VIVARIUM_REAL_LIVE_DIAGNOSTIC_GRACE_MS: '15000',
  }), {
    proofTimeoutMs: 120000,
    diagnosticGraceMs: 15000,
    testTimeoutMs: (120000 * REAL_LIVE_SEQUENTIAL_WAIT_COUNT) + 15000,
  });
});

test('real live timeout budget falls back for invalid values', () => {
  assert.deepEqual(resolveRealLiveTimeoutBudget({
    VIVARIUM_REAL_LIVE_TIMEOUT_MS: '0',
    VIVARIUM_REAL_LIVE_DIAGNOSTIC_GRACE_MS: 'nope',
  }), {
    proofTimeoutMs: DEFAULT_REAL_LIVE_TIMEOUT_MS,
    diagnosticGraceMs: DEFAULT_REAL_LIVE_DIAGNOSTIC_GRACE_MS,
    testTimeoutMs: (
      DEFAULT_REAL_LIVE_TIMEOUT_MS * REAL_LIVE_SEQUENTIAL_WAIT_COUNT
    ) + DEFAULT_REAL_LIVE_DIAGNOSTIC_GRACE_MS,
  });
});
