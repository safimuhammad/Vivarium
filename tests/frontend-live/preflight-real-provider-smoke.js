#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');
const guardPath = path.join(repoRoot, 'tests/frontend-live/guard-real-provider-smoke.js');
const requestTimeoutMs = positiveNumber(process.env.VIVARIUM_REAL_LIVE_TIMEOUT_MS, 120000);
const runDurationMarginMs = positiveNumber(
  process.env.VIVARIUM_REAL_LIVE_DURATION_MARGIN_MS,
  60000,
);
const minimumRunRemainingMs = requestTimeoutMs + runDurationMarginMs;
const requiredRunConstantKeys = [
  'home_upkeep_materials_per_second',
  'mating_cooldown_seconds',
  'ruins_persist_seconds',
];
const frontendEventStreamPath = '/api/events/stream?cursor=0&once=true';

async function main() {
  requireFetch();
  const env = readRequiredEnv();

  runStaticGuard();
  checkPlaywrightChromium();

  const directRun = env.apiUrl
    ? await checkDirectApiRun(env.apiUrl)
    : null;
  if (!env.apiUrl) {
    warn('VIVARIUM_REAL_LIVE_API_URL is not set; skipping direct API /api/run check.');
  }

  await checkFrontendDocument(env.frontendUrl);
  const frontendRun = await checkFrontendRun(env.frontendUrl);
  requireMatchingRunIds(directRun, frontendRun);

  await checkFrontendWorld(env.frontendUrl, frontendRun.run_id);
  await checkFrontendEvents(env.frontendUrl);
  await checkFrontendEventStream(env.frontendUrl);

  pass('External real-provider preflight passed.');
}

function requireFetch() {
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') {
    fail('This preflight requires Node with global fetch and AbortController support.');
  }
}

function runStaticGuard() {
  const result = spawnSync(process.execPath, [guardPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000,
  });

  if (result.error) {
    fail(`Static real-provider guard could not run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = compactOutput(result.stderr || result.stdout);
    fail(`Static real-provider guard failed${detail ? `: ${detail}` : '.'}`);
  }

  pass('Static real-provider guard passed.');
}

function readRequiredEnv() {
  const failures = [];
  const realLiveEnabled = process.env.VIVARIUM_REAL_LIVE === '1';
  const frontendUrl = trimEnv(process.env.VIVARIUM_REAL_LIVE_FRONTEND_URL);
  const apiUrl = trimEnv(process.env.VIVARIUM_REAL_LIVE_API_URL);

  if (!realLiveEnabled) {
    failures.push('Set VIVARIUM_REAL_LIVE=1.');
  }
  if (!frontendUrl) {
    failures.push('Set VIVARIUM_REAL_LIVE_FRONTEND_URL to the already-running frontend URL.');
  }
  if (frontendUrl && !isValidHttpUrl(frontendUrl)) {
    failures.push(`VIVARIUM_REAL_LIVE_FRONTEND_URL is not a valid HTTP(S) URL: ${frontendUrl}`);
  }
  if (apiUrl && !isValidHttpUrl(apiUrl)) {
    failures.push(`VIVARIUM_REAL_LIVE_API_URL is not a valid HTTP(S) URL: ${apiUrl}`);
  }

  if (failures.length > 0) {
    fail(failures.join(' '));
  }

  pass('Required real-live environment is set.');
  return { frontendUrl, apiUrl };
}

function checkPlaywrightChromium() {
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['playwright', 'install', '--dry-run', 'chromium'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 30000,
    },
  );

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      warn('Could not run npx; Playwright Chromium availability was not verified.');
      return;
    }
    fail(`Playwright Chromium availability check errored: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = compactOutput(result.stderr || result.stdout);
    fail(`Playwright Chromium dry-run failed${detail ? `: ${detail}` : '.'}`);
  }

  const locations = parseChromiumInstallLocations(`${result.stdout}\n${result.stderr}`);
  if (locations.length === 0) {
    warn('Playwright dry-run passed, but Chromium install locations could not be parsed.');
    return;
  }

  const existingLocations = locations.filter((location) => fs.existsSync(location));
  if (existingLocations.length === 0) {
    fail(
      'Playwright Chromium browser cache is missing. Run `npx playwright install chromium` ' +
        `outside preflight. Checked: ${locations.join(', ')}`,
    );
  }

  pass(`Playwright Chromium browser cache found at ${existingLocations[0]}.`);
  warn('Playwright dry-run does not launch Chromium; the full smoke is still the browser check.');
}

async function checkDirectApiRun(apiUrl) {
  const body = await fetchJson(joinUrl(apiUrl, '/api/run'), {
    label: 'direct API /api/run',
    expectedStatus: 200,
  });
  requireSchema(body, 'direct API /api/run');
  requireTruthyField(body, 'run_id', 'direct API /api/run');
  requireRunnableRun(body, 'direct API /api/run');
  requireRunConstants(body, 'direct API /api/run');
  pass('Direct API /api/run returned HTTP 200, schema 1, run_id, runnable timing, and constants.');
  return body;
}

async function checkFrontendDocument(frontendUrl) {
  const response = await fetchWithTimeout(joinUrl(frontendUrl, '/'), {
    headers: { Accept: 'text/html,application/xhtml+xml' },
  });

  if (response.status < 200 || response.status >= 300) {
    fail(`Frontend / returned HTTP ${response.status}; expected 2xx.`);
  }

  const contentType = response.contentType || '';
  const text = await response.text();
  if (!isHtmlish(contentType, text)) {
    fail(`Frontend / did not look HTML-ish; content-type was ${formatValue(contentType)}.`);
  }

  pass('Frontend / returned a 2xx HTML-ish response.');
}

async function checkFrontendRun(frontendUrl) {
  const body = await fetchJson(joinUrl(frontendUrl, '/api/run'), {
    label: 'frontend /api/run',
    expectedStatus: 200,
  });
  requireSchema(body, 'frontend /api/run');
  requireTruthyField(body, 'run_id', 'frontend /api/run');
  requireRunnableRun(body, 'frontend /api/run');
  requireRunConstants(body, 'frontend /api/run');
  pass('Frontend /api/run returned HTTP 200, schema 1, run_id, runnable timing, and constants.');
  return body;
}

async function checkFrontendWorld(frontendUrl, runId) {
  const body = await fetchJson(joinUrl(frontendUrl, '/api/world'), {
    label: 'frontend /api/world',
    expectedStatus: 200,
  });
  requireSchema(body, 'frontend /api/world');
  requireMatchingRunId(body, runId, 'frontend /api/world');
  requireNonEmptyArray(body.agents, 'agents', 'frontend /api/world');
  requireNonEmptyArray(body.regions, 'regions', 'frontend /api/world');
  pass('Frontend /api/world returned schema 1, matching run_id, agents, and regions.');
}

async function checkFrontendEvents(frontendUrl) {
  const body = await fetchJson(joinUrl(frontendUrl, '/api/events?cursor=0'), {
    label: 'frontend /api/events?cursor=0',
    expectedStatus: 200,
  });
  requireSchema(body, 'frontend /api/events?cursor=0');
  if (!(Number.isFinite(body.next_cursor) && body.next_cursor > 0)) {
    fail(
      `Frontend /api/events?cursor=0 next_cursor must be > 0; received ` +
        `${formatValue(body.next_cursor)}.`,
    );
  }
  if ('events' in body && !Array.isArray(body.events)) {
    fail('Frontend /api/events?cursor=0 events field must be an array when present.');
  }
  pass('Frontend /api/events?cursor=0 returned schema 1 and next_cursor > 0.');
}

async function checkFrontendEventStream(frontendUrl, options = {}) {
  const label = `frontend ${frontendEventStreamPath}`;
  const response = await fetchEventStream(frontendUrl, options);

  if (response.status < 200 || response.status >= 300) {
    fail(`${label} returned HTTP ${response.status}; expected 2xx.`);
  }

  const contentType = response.contentType || '';
  if (contentType && !/\btext\/event-stream\b/i.test(contentType)) {
    fail(`${label} returned non-SSE content-type ${formatValue(contentType)}.`);
  }

  let envelope;
  try {
    envelope = parseOneSseEnvelope(response.text, label);
  } catch (error) {
    fail(error.message);
  }

  pass(
    `${label} returned schema 1 and next_cursor ${formatValue(envelope.next_cursor)}.`,
  );
  return envelope;
}

async function fetchEventStream(frontendUrl, options = {}) {
  const timeoutMs = positiveNumber(options.requestTimeoutMs, requestTimeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(joinUrl(frontendUrl, frontendEventStreamPath), {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    const status = response.status;
    const contentType = response.headers.get('content-type') || '';
    const text = status >= 200 && status < 300 ? await response.text() : '';
    return { status, contentType, text };
  } catch (error) {
    if (error.name === 'AbortError') {
      fail(`${frontendEventStreamPath} timed out after ${timeoutMs}ms.`);
    }
    fail(`${frontendEventStreamPath} request failed before a complete SSE response was received.`);
  } finally {
    clearTimeout(timeout);
  }
}

function parseOneSseEnvelope(text, label = frontendEventStreamPath) {
  for (const data of parseSseDataPayloads(text)) {
    let envelope;
    try {
      envelope = JSON.parse(data);
    } catch (_error) {
      throw new Error(`${label} returned invalid JSON event data.`);
    }

    validateSseEnvelope(envelope, label);
    return envelope;
  }

  throw new Error(`${label} returned no SSE envelope data.`);
}

function parseSseDataPayloads(text) {
  const payloads = [];
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const events = normalized.split(/\n\n+/);

  for (const event of events) {
    const dataLines = [];
    for (const line of event.split('\n')) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (dataLines.length > 0) {
      payloads.push(dataLines.join('\n'));
    }
  }

  return payloads;
}

function validateSseEnvelope(envelope, label = frontendEventStreamPath) {
  if (!isPlainObject(envelope)) {
    throw new Error(`${label} event data must be an object envelope.`);
  }
  if (envelope.schema !== 1) {
    throw new Error(`${label} schema must be 1; received ${formatValue(envelope.schema)}.`);
  }
  if (!(typeof envelope.next_cursor === 'number' && Number.isFinite(envelope.next_cursor) && envelope.next_cursor > 0)) {
    throw new Error(
      `${label} next_cursor must be a finite number > 0; received ` +
        `${formatValue(envelope.next_cursor)}.`,
    );
  }
}

async function fetchJson(url, { label, expectedStatus }) {
  const response = await fetchWithTimeout(url, {
    headers: { Accept: 'application/json' },
  });
  if (response.status !== expectedStatus) {
    fail(`${label} returned HTTP ${response.status}; expected ${expectedStatus}.`);
  }

  const contentType = response.headers.get('content-type') || '';
  let body;
  try {
    body = await response.json();
  } catch (error) {
    fail(`${label} did not return valid JSON (${error.message}); content-type was ${contentType}.`);
  }

  if (!isPlainObject(body)) {
    fail(`${label} returned JSON ${formatValue(body)}; expected an object envelope.`);
  }
  return body;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      fail(`Request timed out after ${requestTimeoutMs}ms: ${url}`);
    }
    fail(`Request failed for ${url}: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function requireSchema(body, label) {
  if (body.schema !== 1) {
    fail(`${label} schema must be 1; received ${formatValue(body.schema)}.`);
  }
}

function requireTruthyField(body, field, label) {
  if (!body[field]) {
    fail(`${label} ${field} must be truthy; received ${formatValue(body[field])}.`);
  }
  return body[field];
}

function requireMatchingRunId(body, runId, label) {
  if (body.run_id !== runId) {
    fail(`${label} run_id ${formatValue(body.run_id)} does not match ${formatValue(runId)}.`);
  }
}

function requireNonEmptyArray(value, field, label) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${label} ${field} must be a non-empty array.`);
  }
}

function requireRunnableRun(body, label) {
  let result;
  try {
    result = validateRunnableRun(body, label);
  } catch (error) {
    fail(error.message);
  }
  pass(`${label} has ${formatDurationMs(result.remainingMs)} remaining for the browser smoke.`);
}

function requireRunConstants(body, label) {
  try {
    validateRunConstants(body, label);
  } catch (error) {
    fail(error.message);
  }
  pass(`${label} constants include required positive timing values.`);
}

function validateRunnableRun(body, label, options = {}) {
  const timeoutMs = positiveNumber(options.requestTimeoutMs, requestTimeoutMs);
  const marginMs = positiveNumber(options.runDurationMarginMs, runDurationMarginMs);
  const minRemainingMs = timeoutMs + marginMs;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();

  if (body.status !== 'running') {
    throw new Error(`${label} status must be "running" before browser smoke; received ${formatValue(body.status)}.`);
  }

  if (!isPlainObject(body.timing)) {
    throw new Error(`${label} timing must be an object with duration seconds before browser smoke.`);
  }

  const timing = body.timing;
  const durationSeconds = Number(timing.duration);
  const durationMs = durationSeconds * 1000;
  if (!(Number.isFinite(durationMs) && durationMs > 0)) {
    throw new Error(`${label} timing.duration must be a positive number of seconds before browser smoke; received ${formatValue(timing.duration)}.`);
  }

  const startedAtSeconds = Number(body.started_at);
  if (!(Number.isFinite(startedAtSeconds) && startedAtSeconds > 0)) {
    throw new Error(`${label} started_at must be a positive epoch-seconds value before browser smoke; received ${formatValue(body.started_at)}.`);
  }

  const elapsedMs = Math.max(0, nowMs - startedAtSeconds * 1000);
  const remainingMs = durationMs - elapsedMs;
  if (remainingMs <= minRemainingMs) {
    throw new Error(remainingDurationMessage(label, remainingMs, durationMs, elapsedMs, {
      minimumRunRemainingMs: minRemainingMs,
      requestTimeoutMs: timeoutMs,
      runDurationMarginMs: marginMs,
    }));
  }

  return { remainingMs, durationMs, elapsedMs };
}

function validateRunConstants(body, label) {
  if (!isPlainObject(body.constants)) {
    throw new Error(`${label} constants must be an object with required timing values.`);
  }

  const { constants } = body;
  for (const key of requiredRunConstantKeys) {
    if (!Object.prototype.hasOwnProperty.call(constants, key)) {
      throw new Error(`${label} constants.${key} must be present.`);
    }

    const value = constants[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(
        `${label} constants.${key} must be a finite number > 0; received ${formatValue(value)}.`,
      );
    }
  }

  return constants;
}

function requireMatchingRunIds(directRun, frontendRun) {
  const message = validateRunIdMatch(directRun, frontendRun);
  if (message) {
    fail(message);
  }
}

function validateRunIdMatch(directRun, frontendRun) {
  if (directRun !== null && directRun.run_id !== frontendRun.run_id) {
    return (
      `Direct API run_id ${formatValue(directRun.run_id)} does not match frontend /api/run ` +
      `run_id ${formatValue(frontendRun.run_id)}.`
    );
  }
  return null;
}

function parseChromiumInstallLocations(output) {
  const locations = [];
  let inChromiumBlock = false;

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (/^(Chrome for Testing|Chrome Headless Shell|Chromium)\b/i.test(trimmed)) {
      inChromiumBlock = true;
      continue;
    }
    if (/^FFmpeg\b/i.test(trimmed)) {
      inChromiumBlock = false;
      continue;
    }

    const locationMatch = trimmed.match(/^Install location:\s*(.+)$/i);
    if (inChromiumBlock && locationMatch) {
      locations.push(locationMatch[1]);
    }
  }

  return locations;
}

function joinUrl(baseUrl, pathSuffix) {
  return `${baseUrl.replace(/\/+$/, '')}${pathSuffix}`;
}

function trimEnv(value) {
  return (value || '').trim();
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function remainingDurationMessage(label, remainingMs, durationMs, elapsedMs, options = {}) {
  const timeoutMs = positiveNumber(options.requestTimeoutMs, requestTimeoutMs);
  const marginMs = positiveNumber(options.runDurationMarginMs, runDurationMarginMs);
  const minRemainingMs = positiveNumber(options.minimumRunRemainingMs, timeoutMs + marginMs);
  return (
    `${label} has only ${formatDurationMs(remainingMs)} of backend runtime remaining ` +
    `(duration ${formatDurationMs(durationMs)}, elapsed ${formatDurationMs(elapsedMs)}). ` +
    `The browser smoke may wait ${formatDurationMs(timeoutMs)} plus ` +
    `${formatDurationMs(marginMs)} preflight margin. Restart the API with ` +
    `--duration at least ${recommendedDurationSeconds(elapsedMs, minRemainingMs)} or lower ` +
    'VIVARIUM_REAL_LIVE_TIMEOUT_MS.'
  );
}

function recommendedDurationSeconds(elapsedMs, minRemainingMs = minimumRunRemainingMs) {
  return Math.ceil(Math.max(1800, (elapsedMs + minRemainingMs) / 1000));
}

function formatDurationMs(value) {
  if (!Number.isFinite(value)) {
    return formatValue(value);
  }
  const seconds = value / 1000;
  const precision = Math.abs(seconds) < 10 ? 1 : 0;
  return `${seconds.toFixed(precision)}s`;
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_error) {
    return false;
  }
}

function isHtmlish(contentType, text) {
  return (
    /\bhtml\b/i.test(contentType) ||
    /<!doctype\s+html/i.test(text) ||
    /<html[\s>]/i.test(text) ||
    /<body[\s>]/i.test(text)
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compactOutput(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(' ');
}

function formatValue(value) {
  return JSON.stringify(value);
}

function pass(message) {
  console.log(`PASS ${message}`);
}

function warn(message) {
  console.warn(`WARN ${message}`);
}

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    fail(error && error.stack ? error.stack : String(error));
  });
}

module.exports = {
  _test: {
    checkDirectApiRun,
    checkFrontendEventStream,
    checkFrontendRun,
    parseOneSseEnvelope,
    parseSseDataPayloads,
    validateSseEnvelope,
    validateRunConstants,
    validateRunnableRun,
    validateRunIdMatch,
  },
};
