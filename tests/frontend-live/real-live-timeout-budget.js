const DEFAULT_REAL_LIVE_TIMEOUT_MS = 120000;
const DEFAULT_REAL_LIVE_DIAGNOSTIC_GRACE_MS = 15000;
const REAL_LIVE_SEQUENTIAL_WAIT_COUNT = 5;

function resolveRealLiveTimeoutBudget(env = process.env) {
  const proofTimeoutMs = positiveNumber(
    env.VIVARIUM_REAL_LIVE_TIMEOUT_MS,
    DEFAULT_REAL_LIVE_TIMEOUT_MS,
  );
  const diagnosticGraceMs = positiveNumber(
    env.VIVARIUM_REAL_LIVE_DIAGNOSTIC_GRACE_MS,
    DEFAULT_REAL_LIVE_DIAGNOSTIC_GRACE_MS,
  );
  return {
    proofTimeoutMs,
    diagnosticGraceMs,
    testTimeoutMs: (proofTimeoutMs * REAL_LIVE_SEQUENTIAL_WAIT_COUNT) + diagnosticGraceMs,
  };
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  DEFAULT_REAL_LIVE_DIAGNOSTIC_GRACE_MS,
  DEFAULT_REAL_LIVE_TIMEOUT_MS,
  REAL_LIVE_SEQUENTIAL_WAIT_COUNT,
  resolveRealLiveTimeoutBudget,
};
