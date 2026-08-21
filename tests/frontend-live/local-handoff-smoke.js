#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const localHost = '127.0.0.1';
const requestTimeoutMsDefault = 10000;
const startupTimeoutMsDefault = 45000;
const shutdownTimeoutMsDefault = 5000;
const ssePath = '/api/events/stream?cursor=0&once=true';
const mechanicsPath = '/api/test/mechanics/run';
const expectedMechanicsVersion = 'layer-22b-live-mechanics-v3';
const minimumMechanicsEventTypeCount = 27;
const minimumMechanicsToolCount = 24;

async function main(argv = process.argv.slice(2), env = process.env) {
  requireFetch();
  const config = parseCliArgs(argv, env);
  if (config.help) {
    console.log(usage());
    return;
  }

  const selectedPorts = await selectPorts(config);
  await assertPortAvailable(selectedPorts.api.port, 'API');
  await assertPortAvailable(selectedPorts.frontend.port, 'frontend');
  const apiBaseUrl = `http://${localHost}:${selectedPorts.api.port}`;
  const frontendBaseUrl = `http://${localHost}:${selectedPorts.frontend.port}`;
  let apiProcess = null;
  let frontendProcess = null;
  let checks = null;
  let shutdown = null;

  try {
    apiProcess = startChildProcess('deterministic API', env.PYTHON || 'python3', [
      '-m',
      'tests.frontend_live.live_api_server',
      '--host',
      localHost,
      '--port',
      String(selectedPorts.api.port),
      '--log-level',
      'warning',
    ], {
      env,
      verbose: config.verbose,
    });

    await waitForProbe({
      label: 'deterministic API /api/run',
      processInfo: apiProcess,
      timeoutMs: config.startupTimeoutMs,
      probe: () => checkRun(apiBaseUrl, 'direct API /api/run', config.requestTimeoutMs),
    });

    await assertPortAvailable(selectedPorts.frontend.port, 'frontend');
    frontendProcess = startChildProcess('Vite frontend', npmCommand(), [
      '--prefix',
      'frontend',
      'run',
      'dev',
      '--',
      '--host',
      localHost,
      '--port',
      String(selectedPorts.frontend.port),
      '--strictPort',
    ], {
      env: {
        ...env,
        VIVARIUM_API_TARGET: apiBaseUrl,
      },
      verbose: config.verbose,
    });

    await waitForProbe({
      label: 'Vite frontend /',
      processInfo: frontendProcess,
      timeoutMs: config.startupTimeoutMs,
      probe: () => checkFrontendHtml(frontendBaseUrl, config.requestTimeoutMs),
    });

    checks = await runSmokeChecks({
      apiBaseUrl,
      frontendBaseUrl,
      requestTimeoutMs: config.requestTimeoutMs,
    });
  } finally {
    shutdown = {
      frontend: await stopChildProcess(frontendProcess, config.shutdownTimeoutMs),
      api: await stopChildProcess(apiProcess, config.shutdownTimeoutMs),
    };
  }

  const summary = buildSummary(checks, selectedPorts, shutdown);
  console.log(formatSummary(summary, { jsonOnly: config.jsonOnly }));
}

function requireFetch() {
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') {
    throw new Error('This smoke requires Node with global fetch and AbortController support.');
  }
}

async function runSmokeChecks({ apiBaseUrl, frontendBaseUrl, requestTimeoutMs }) {
  const directRun = await checkRun(apiBaseUrl, 'direct API /api/run', requestTimeoutMs);
  const directWorld = await checkWorld(
    apiBaseUrl,
    'direct API /api/world',
    directRun.runId,
    requestTimeoutMs,
  );
  const directSse = await checkSse(
    apiBaseUrl,
    'direct API one-shot SSE',
    requestTimeoutMs,
  );
  const frontendHtml = await checkFrontendHtml(frontendBaseUrl, requestTimeoutMs);
  const proxiedRun = await checkRun(frontendBaseUrl, 'proxied /api/run', requestTimeoutMs);
  requireEqualRunIds(directRun.runId, proxiedRun.runId);
  const proxiedWorld = await checkWorld(
    frontendBaseUrl,
    'proxied /api/world',
    proxiedRun.runId,
    requestTimeoutMs,
  );
  const proxiedSse = await checkSse(
    frontendBaseUrl,
    'proxied one-shot SSE',
    requestTimeoutMs,
  );
  const mechanics = await checkMechanics(frontendBaseUrl, requestTimeoutMs);
  const postMechanicsWorld = await checkWorld(
    frontendBaseUrl,
    'post-mechanics proxied /api/world',
    proxiedRun.runId,
    requestTimeoutMs,
  );
  if (postMechanicsWorld.eventCursor < mechanics.endCursor) {
    throw new Error(
      'post-mechanics proxied /api/world event_cursor must cover mechanics end_cursor.',
    );
  }

  return {
    directRun,
    directWorld,
    directSse,
    frontendHtml,
    proxiedRun,
    proxiedWorld,
    proxiedSse,
    mechanics,
    postMechanicsWorld,
  };
}

async function checkRun(baseUrl, label, requestTimeoutMs) {
  const body = await fetchJson(joinUrl(baseUrl, '/api/run'), {
    label,
    requestTimeoutMs,
  });
  return validateRunEnvelope(body, label);
}

async function checkWorld(baseUrl, label, expectedRunId, requestTimeoutMs) {
  const body = await fetchJson(joinUrl(baseUrl, '/api/world'), {
    label,
    requestTimeoutMs,
  });
  return validateWorldEnvelope(body, label, expectedRunId);
}

async function checkSse(baseUrl, label, requestTimeoutMs) {
  const response = await fetchText(joinUrl(baseUrl, ssePath), {
    label,
    requestTimeoutMs,
    headers: { Accept: 'text/event-stream' },
  });
  const contentType = response.contentType || '';
  if (contentType && !/\btext\/event-stream\b/i.test(contentType)) {
    throw new Error(`${label} returned non-SSE content-type ${formatValue(contentType)}.`);
  }

  const envelope = parseOneSseEnvelope(response.text, label);
  return validateSseEnvelope(envelope, label);
}

async function checkFrontendHtml(baseUrl, requestTimeoutMs) {
  const response = await fetchText(joinUrl(baseUrl, '/'), {
    label: 'frontend /',
    requestTimeoutMs,
    headers: { Accept: 'text/html,application/xhtml+xml' },
  });
  if (!isHtmlish(response.contentType, response.text)) {
    throw new Error(
      `frontend / did not look HTML-ish; content-type was ${formatValue(response.contentType)}.`,
    );
  }
  return { ok: true };
}

async function checkMechanics(baseUrl, requestTimeoutMs) {
  const body = await fetchJson(joinUrl(baseUrl, mechanicsPath), {
    label: mechanicsPath,
    requestTimeoutMs,
    method: 'POST',
  });
  return validateMechanicsEnvelope(body, mechanicsPath);
}

async function fetchJson(url, { label, requestTimeoutMs, method = 'GET' }) {
  const response = await fetchWithTimeout(url, {
    method,
    headers: { Accept: 'application/json' },
  }, requestTimeoutMs);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${label} returned HTTP ${response.status}; expected 2xx.`);
  }

  let body;
  try {
    body = await readBodyWithTimeout(
      () => response.json(),
      requestTimeoutMs,
      `${label} JSON body`,
    );
  } catch (error) {
    throw new Error(`${label} did not return valid JSON: ${error.message}.`);
  }
  if (!isPlainObject(body)) {
    throw new Error(`${label} returned JSON ${formatValue(body)}; expected an object envelope.`);
  }
  return body;
}

async function fetchText(url, { label, requestTimeoutMs, headers }) {
  const response = await fetchWithTimeout(url, { headers }, requestTimeoutMs);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${label} returned HTTP ${response.status}; expected 2xx.`);
  }
  return {
    contentType: response.headers.get('content-type') || '',
    text: await readBodyWithTimeout(
      () => response.text(),
      requestTimeoutMs,
      `${label} response body`,
    ),
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw new Error(`Request failed for ${url}: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function readBodyWithTimeout(readBody, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    readBody().then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function validateRunEnvelope(body, label) {
  requireSchema(body, label);
  const runId = requireTruthyField(body, 'run_id', label);
  if (body.status !== 'running') {
    throw new Error(`${label} status must be "running"; received ${formatValue(body.status)}.`);
  }
  const eventCursor = requireNonNegativeCursor(body.event_cursor, `${label} event_cursor`);
  return { ok: true, runId, eventCursor };
}

function validateWorldEnvelope(body, label, expectedRunId) {
  requireSchema(body, label);
  const runId = requireTruthyField(body, 'run_id', label);
  if (expectedRunId !== undefined && runId !== expectedRunId) {
    throw new Error(
      `${label} run_id ${formatValue(runId)} does not match ${formatValue(expectedRunId)}.`,
    );
  }
  requireNonEmptyArray(body.agents, 'agents', label);
  requireNonEmptyArray(body.regions, 'regions', label);
  const eventCursor = requireNonNegativeCursor(body.event_cursor, `${label} event_cursor`);
  return { ok: true, runId, eventCursor };
}

function validateSseEnvelope(envelope, label) {
  if (!isPlainObject(envelope)) {
    throw new Error(`${label} event data must be an object envelope.`);
  }
  requireSchema(envelope, label);
  const nextCursor = requirePositiveCursor(envelope.next_cursor, `${label} next_cursor`);
  if (!Array.isArray(envelope.events)) {
    throw new Error(`${label} events must be an array.`);
  }
  if (envelope.events.length === 0) {
    throw new Error(`${label} events must include at least one event.`);
  }
  return { ok: true, nextCursor, eventCount: envelope.events.length };
}

function validateMechanicsEnvelope(body, label) {
  requireSchema(body, label);
  if (body.version !== expectedMechanicsVersion) {
    throw new Error(
      `${label} version must be ${formatValue(expectedMechanicsVersion)}; ` +
        `received ${formatValue(body.version)}.`,
    );
  }
  if (body.newly_ran !== true) {
    throw new Error(`${label} newly_ran must be true; received ${formatValue(body.newly_ran)}.`);
  }
  if (body.reused_cached_result !== false) {
    throw new Error(
      `${label} reused_cached_result must be false; ` +
        `received ${formatValue(body.reused_cached_result)}.`,
    );
  }
  const startCursor = requireNonNegativeCursor(body.start_cursor, `${label} start_cursor`);
  const endCursor = requirePositiveCursor(body.end_cursor, `${label} end_cursor`);
  if (endCursor <= startCursor) {
    throw new Error(`${label} end_cursor must be greater than start_cursor.`);
  }
  requireNonEmptyArray(body.event_types, 'event_types', label);
  requireNonEmptyArray(body.tools, 'tools', label);
  const uniqueEventTypeCount = new Set(body.event_types).size;
  if (uniqueEventTypeCount < minimumMechanicsEventTypeCount) {
    throw new Error(
      `${label} must include at least ${minimumMechanicsEventTypeCount} unique event types; ` +
        `received ${uniqueEventTypeCount}.`,
    );
  }
  if (body.tools.length < minimumMechanicsToolCount) {
    throw new Error(
      `${label} must include at least ${minimumMechanicsToolCount} tool outcomes; ` +
        `received ${body.tools.length}.`,
    );
  }
  const failedTools = body.tools.filter((tool) => !isPlainObject(tool) || tool.ok !== true);
  if (failedTools.length > 0) {
    throw new Error(`${label} reported ${failedTools.length} failed tool outcome(s).`);
  }
  return {
    ok: true,
    startCursor,
    endCursor,
    eventTypeCount: uniqueEventTypeCount,
    emittedEventCount: body.event_types.length,
    toolCount: body.tools.length,
  };
}

function parseOneSseEnvelope(text, label = ssePath) {
  for (const data of parseSseDataPayloads(text)) {
    try {
      return JSON.parse(data);
    } catch (_error) {
      throw new Error(`${label} returned invalid JSON event data.`);
    }
  }
  throw new Error(`${label} returned no SSE envelope data.`);
}

function parseSseDataPayloads(text) {
  const payloads = [];
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (const event of normalized.split(/\n\n+/)) {
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

function requireSchema(body, label) {
  if (body.schema !== 1) {
    throw new Error(`${label} schema must be 1; received ${formatValue(body.schema)}.`);
  }
}

function requireTruthyField(body, field, label) {
  if (!body[field]) {
    throw new Error(`${label} ${field} must be truthy; received ${formatValue(body[field])}.`);
  }
  return body[field];
}

function requireNonEmptyArray(value, field, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} ${field} must be a non-empty array.`);
  }
}

function requireNonNegativeCursor(value, label) {
  if (!(Number.isInteger(value) && value >= 0)) {
    throw new Error(`${label} must be an integer >= 0; received ${formatValue(value)}.`);
  }
  return value;
}

function requirePositiveCursor(value, label) {
  if (!(Number.isInteger(value) && value > 0)) {
    throw new Error(`${label} must be an integer > 0; received ${formatValue(value)}.`);
  }
  return value;
}

function requireEqualRunIds(directRunId, proxiedRunId) {
  if (directRunId !== proxiedRunId) {
    throw new Error(
      `direct API run_id ${formatValue(directRunId)} does not match proxied run_id ` +
        `${formatValue(proxiedRunId)}.`,
    );
  }
}

function buildSummary(checks, selectedPorts, shutdown = {}) {
  return {
    mode: 'deterministic-local-handoff',
    real_live: false,
    ports: {
      api: {
        mode: selectedPorts.api.mode === 'explicit' ? 'explicit' : 'auto-selected',
        port: selectedPorts.api.port,
      },
      frontend: {
        mode: selectedPorts.frontend.mode === 'explicit' ? 'explicit' : 'auto-selected',
        port: selectedPorts.frontend.port,
      },
    },
    run: {
      run_id_matched: checks.directRun.runId === checks.proxiedRun.runId,
      direct_event_cursor: checks.directRun.eventCursor,
      proxied_event_cursor: checks.proxiedRun.eventCursor,
      direct_world_event_cursor: checks.directWorld.eventCursor,
      proxied_world_event_cursor: checks.proxiedWorld.eventCursor,
    },
    sse: {
      direct_next_cursor: checks.directSse.nextCursor,
      direct_event_count: checks.directSse.eventCount,
      proxied_next_cursor: checks.proxiedSse.nextCursor,
      proxied_event_count: checks.proxiedSse.eventCount,
    },
    checks: {
      direct_run: checks.directRun.ok ? 'ok' : 'failed',
      direct_world: checks.directWorld.ok ? 'ok' : 'failed',
      direct_sse: checks.directSse.ok ? 'ok' : 'failed',
      frontend_html: checks.frontendHtml.ok ? 'ok' : 'failed',
      proxied_run: checks.proxiedRun.ok ? 'ok' : 'failed',
      proxied_world: checks.proxiedWorld.ok ? 'ok' : 'failed',
      proxied_sse: checks.proxiedSse.ok ? 'ok' : 'failed',
      mechanics_post: checks.mechanics.ok ? 'ok' : 'failed',
      post_mechanics_world_cursor: (
        checks.postMechanicsWorld.eventCursor >= checks.mechanics.endCursor ? 'ok' : 'failed'
      ),
    },
    mechanics: {
      start_cursor: checks.mechanics.startCursor,
      end_cursor: checks.mechanics.endCursor,
      event_type_count: checks.mechanics.eventTypeCount,
      emitted_event_count: checks.mechanics.emittedEventCount,
      tool_count: checks.mechanics.toolCount,
      all_tools_ok: true,
      cursor_advanced: checks.mechanics.endCursor > checks.mechanics.startCursor,
      post_world_cursor: checks.postMechanicsWorld.eventCursor,
      post_world_cursor_covers_mechanics: (
        checks.postMechanicsWorld.eventCursor >= checks.mechanics.endCursor
      ),
    },
    shutdown: {
      api: shutdown.api || { status: 'not-started' },
      frontend: shutdown.frontend || { status: 'not-started' },
    },
  };
}

function formatSummary(summary, { jsonOnly = false } = {}) {
  const json = JSON.stringify(summary, null, 2);
  return jsonOnly ? json : `PASS deterministic local handoff smoke\n${json}`;
}

function parseCliArgs(argv, env) {
  const config = {
    apiPort: parsePortSetting(env.VIVARIUM_LOCAL_HANDOFF_API_PORT, 'VIVARIUM_LOCAL_HANDOFF_API_PORT'),
    frontendPort: parsePortSetting(
      env.VIVARIUM_LOCAL_HANDOFF_FRONTEND_PORT,
      'VIVARIUM_LOCAL_HANDOFF_FRONTEND_PORT',
    ),
    requestTimeoutMs: positiveInteger(
      env.VIVARIUM_LOCAL_HANDOFF_REQUEST_TIMEOUT_MS,
      requestTimeoutMsDefault,
      'VIVARIUM_LOCAL_HANDOFF_REQUEST_TIMEOUT_MS',
    ),
    startupTimeoutMs: positiveInteger(
      env.VIVARIUM_LOCAL_HANDOFF_STARTUP_TIMEOUT_MS,
      startupTimeoutMsDefault,
      'VIVARIUM_LOCAL_HANDOFF_STARTUP_TIMEOUT_MS',
    ),
    shutdownTimeoutMs: positiveInteger(
      env.VIVARIUM_LOCAL_HANDOFF_SHUTDOWN_TIMEOUT_MS,
      shutdownTimeoutMsDefault,
      'VIVARIUM_LOCAL_HANDOFF_SHUTDOWN_TIMEOUT_MS',
    ),
    jsonOnly: env.VIVARIUM_LOCAL_HANDOFF_JSON === '1',
    verbose: env.VIVARIUM_LOCAL_HANDOFF_VERBOSE === '1',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      config.help = true;
      continue;
    }
    if (arg === '--json') {
      config.jsonOnly = true;
      continue;
    }
    if (arg === '--verbose') {
      config.verbose = true;
      continue;
    }

    const parsedFlag = parseFlagValue(argv, index);
    if (parsedFlag.consumed === 0) {
      throw new Error(`Unknown argument ${formatValue(arg)}.`);
    }
    index += parsedFlag.consumed - 1;

    switch (parsedFlag.name) {
      case '--api-port':
        config.apiPort = parsePortSetting(parsedFlag.value, '--api-port');
        break;
      case '--frontend-port':
        config.frontendPort = parsePortSetting(parsedFlag.value, '--frontend-port');
        break;
      case '--request-timeout-ms':
        config.requestTimeoutMs = positiveInteger(
          parsedFlag.value,
          requestTimeoutMsDefault,
          '--request-timeout-ms',
        );
        break;
      case '--startup-timeout-ms':
        config.startupTimeoutMs = positiveInteger(
          parsedFlag.value,
          startupTimeoutMsDefault,
          '--startup-timeout-ms',
        );
        break;
      case '--shutdown-timeout-ms':
        config.shutdownTimeoutMs = positiveInteger(
          parsedFlag.value,
          shutdownTimeoutMsDefault,
          '--shutdown-timeout-ms',
        );
        break;
      default:
        throw new Error(`Unknown argument ${formatValue(parsedFlag.name)}.`);
    }
  }

  return config;
}

function parseFlagValue(argv, index) {
  const arg = argv[index];
  const equalsIndex = arg.indexOf('=');
  if (equalsIndex > 0) {
    return {
      name: arg.slice(0, equalsIndex),
      value: arg.slice(equalsIndex + 1),
      consumed: 1,
    };
  }
  const flagsWithValues = new Set([
    '--api-port',
    '--frontend-port',
    '--request-timeout-ms',
    '--startup-timeout-ms',
    '--shutdown-timeout-ms',
  ]);
  if (!flagsWithValues.has(arg)) {
    return { consumed: 0 };
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${arg} requires a value.`);
  }
  return { name: arg, value, consumed: 2 };
}

function parsePortSetting(value, label) {
  const raw = trimValue(value);
  if (raw === '' || raw.toLowerCase() === 'auto' || raw === '0') {
    return { mode: 'auto', port: null, label };
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be a TCP port from 1 to 65535, 0, or "auto".`);
  }
  return { mode: 'explicit', port, label };
}

function positiveInteger(value, fallback, label) {
  const raw = trimValue(value);
  if (raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

async function selectPorts(config) {
  const reserved = new Set();
  const api = await resolvePort(config.apiPort, reserved);
  reserved.add(api.port);
  const frontend = await resolvePort(config.frontendPort, reserved);
  if (api.port === frontend.port) {
    throw new Error('API and frontend ports must be different.');
  }
  return { api, frontend };
}

async function assertPortAvailable(port, label) {
  try {
    await listenOnPort(port);
  } catch (error) {
    throw new Error(`${label} port ${port} is not available: ${error.message}`);
  }
}

async function resolvePort(setting, reserved) {
  if (setting.mode === 'explicit') {
    if (reserved.has(setting.port)) {
      throw new Error(`${setting.label} must not reuse another selected port.`);
    }
    return { mode: 'explicit', port: setting.port };
  }
  return { mode: 'auto', port: await findOpenPort(reserved) };
}

async function findOpenPort(reserved) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await listenOnEphemeralPort();
    if (!reserved.has(port)) {
      return port;
    }
  }
  throw new Error('Could not auto-select distinct local ports.');
}

function listenOnEphemeralPort() {
  return listenOnPort(0);
}

function listenOnPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(port, localHost, () => {
      const address = server.address();
      const selectedPort = address && typeof address === 'object' ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!selectedPort) {
          reject(new Error('Ephemeral port selection did not return a TCP port.'));
          return;
        }
        resolve(selectedPort);
      });
    });
  });
}

function startChildProcess(label, command, args, { env, verbose }) {
  const output = createOutputBuffer();
  const detached = process.platform !== 'win32';
  const child = spawn(command, args, {
    cwd: repoRoot,
    env,
    detached,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const processInfo = {
    label,
    child,
    detached,
    output,
    spawnError: null,
    exited: false,
    exitCode: null,
    signal: null,
    exitPromise: null,
  };
  processInfo.exitPromise = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      processInfo.exited = true;
      processInfo.exitCode = code;
      processInfo.signal = signal;
      resolve({ code, signal });
    });
  });
  child.once('error', (error) => {
    processInfo.spawnError = error;
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    output.add('stdout', chunk);
    if (verbose) {
      process.stdout.write(chunk);
    }
  });
  child.stderr.on('data', (chunk) => {
    output.add('stderr', chunk);
    if (verbose) {
      process.stderr.write(chunk);
    }
  });
  return processInfo;
}

async function stopChildProcess(processInfo, shutdownTimeoutMs) {
  if (!processInfo || processInfo.exited) {
    return processInfo
      ? {
        status: 'already-exited',
        exit_code: processInfo.exitCode,
        signal: processInfo.signal,
      }
      : { status: 'not-started' };
  }
  signalChildProcess(processInfo, 'SIGTERM');
  const exited = await promiseWithTimeout(processInfo.exitPromise, shutdownTimeoutMs);
  if (!exited && !processInfo.exited) {
    signalChildProcess(processInfo, 'SIGKILL');
    const killed = await promiseWithTimeout(processInfo.exitPromise, 1000);
    return {
      status: killed || processInfo.exited ? 'killed' : 'kill-timeout',
      exit_code: processInfo.exitCode,
      signal: processInfo.signal,
    };
  }
  return {
    status: 'terminated',
    exit_code: processInfo.exitCode,
    signal: processInfo.signal,
  };
}

function signalChildProcess(processInfo, signal) {
  try {
    if (processInfo.detached && processInfo.child.pid) {
      process.kill(-processInfo.child.pid, signal);
    } else {
      processInfo.child.kill(signal);
    }
  } catch (error) {
    if (error.code !== 'ESRCH') {
      throw error;
    }
  }
}

function promiseWithTimeout(promise, timeoutMs) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    promise.then(
      () => {
        clearTimeout(timeout);
        resolve(true);
      },
      () => {
        clearTimeout(timeout);
        resolve(true);
      },
    );
  });
}

async function waitForProbe({ label, processInfo, timeoutMs, probe }) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (processInfo.spawnError) {
      throw new Error(`${processInfo.label} failed to start: ${processInfo.spawnError.message}`);
    }
    if (processInfo.exited) {
      throw new Error(`${processInfo.label} exited before ${label} was ready.${outputSuffix(processInfo)}`);
    }
    try {
      const result = await probe();
      await sleep(100);
      if (processInfo.spawnError) {
        throw new Error(`${processInfo.label} failed to start: ${processInfo.spawnError.message}`);
      }
      if (processInfo.exited) {
        throw new Error(
          `${processInfo.label} exited after ${label} responded.${outputSuffix(processInfo)}`,
        );
      }
      return result;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  throw new Error(
    `${label} was not ready after ${timeoutMs}ms.` +
      `${lastError ? ` Last error: ${lastError.message}` : ''}` +
      outputSuffix(processInfo),
  );
}

function createOutputBuffer() {
  const lines = [];
  return {
    add(stream, chunk) {
      for (const line of String(chunk).split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) {
          lines.push(`${stream}: ${trimmed}`);
        }
      }
      while (lines.length > 12) {
        lines.shift();
      }
    },
    tail() {
      return lines.join(' ');
    },
  };
}

function outputSuffix(processInfo) {
  const tail = processInfo.output.tail();
  return tail ? ` Recent output: ${tail}` : '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function joinUrl(baseUrl, pathSuffix) {
  return `${baseUrl.replace(/\/+$/, '')}${pathSuffix}`;
}

function trimValue(value) {
  return (value === undefined || value === null ? '' : String(value)).trim();
}

function isHtmlish(contentType, text) {
  return (
    /\bhtml\b/i.test(contentType || '') ||
    /<!doctype\s+html/i.test(text) ||
    /<html[\s>]/i.test(text) ||
    /<body[\s>]/i.test(text)
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function formatValue(value) {
  return JSON.stringify(value);
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function usage() {
  return [
    'Usage: npm run test:frontend:live:local-handoff -- [options]',
    '',
    'Options:',
    '  --api-port <port|auto>       API port, defaults to auto-selected.',
    '  --frontend-port <port|auto>  Vite port, defaults to auto-selected.',
    '  --request-timeout-ms <ms>    Per-request timeout, defaults to 10000.',
    '  --startup-timeout-ms <ms>    API/Vite readiness timeout, defaults to 45000.',
    '  --shutdown-timeout-ms <ms>   Process shutdown grace period, defaults to 5000.',
    '  --json                      Print only the JSON summary.',
    '  --verbose                   Stream child process output while running.',
  ].join('\n');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`FAIL ${error && error.stack ? error.stack : String(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  _test: {
    buildSummary,
    formatSummary,
    parseCliArgs,
    parseOneSseEnvelope,
    parsePortSetting,
    parseSseDataPayloads,
    requireEqualRunIds,
    assertPortAvailable,
    validateMechanicsEnvelope,
    validateRunEnvelope,
    validateSseEnvelope,
    validateWorldEnvelope,
  },
};
