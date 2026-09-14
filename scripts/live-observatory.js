#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const defaultHost = '127.0.0.1';
const defaultConfigPath = 'config/world.yaml';
const defaultSeed = 7;
const defaultProvider = 'mlx';
const defaultPace = 1;
const defaultDuration = 1800;
const defaultWorldTickInterval = 5;
const defaultRefreshInterval = 2;
const defaultMemoryRoot = 'runs/memory';
const defaultRunDir = 'runs';
const defaultStartupTimeoutMs = 120000;
const defaultShutdownTimeoutMs = 5000;
const defaultRequestTimeoutMs = 10000;

async function main(argv = process.argv.slice(2), env = process.env, io = console) {
  const config = parseCliArgs(argv, env);
  if (config.help) {
    io.log(usage());
    return;
  }

  const selectedPorts = await selectPorts(config);
  await assertPortAvailable(selectedPorts.api.port, 'API', config.host);
  await assertPortAvailable(selectedPorts.frontend.port, 'frontend', config.host);
  const plan = buildLaunchPlan(config, selectedPorts, env);

  if (config.dryRun) {
    io.log(formatSummary(buildDryRunSummary(config, selectedPorts, plan), config));
    return;
  }

  requireFetch();
  await launchObservatory(config, selectedPorts, plan, env, io);
}

async function launchObservatory(config, selectedPorts, plan, env, io) {
  let apiProcess = null;
  let frontendProcess = null;
  const stopController = createStopSignalController();
  try {
    apiProcess = startChildProcess('production live API', plan.commands.api.command, plan.commands.api.args, {
      env,
      verbose: config.verbose,
    });

    const apiProbe = await waitForOperationOrStop(waitForProbe({
      label: 'production API /api/run',
      processInfo: apiProcess,
      timeoutMs: config.startupTimeoutMs,
      probe: () => checkRun(
        plan.urls.api,
        config.requestTimeoutMs,
        config.idle ? 'ready' : 'running',
      ),
    }), stopController);
    if (apiProbe.stopped) {
      return;
    }
    const run = apiProbe.value;

    await assertPortAvailable(selectedPorts.frontend.port, 'frontend', config.host);
    frontendProcess = startChildProcess(
      'Vite frontend',
      plan.commands.frontend.command,
      plan.commands.frontend.args,
      {
        env: {
          ...env,
          VIVARIUM_API_TARGET: plan.urls.api,
        },
        verbose: config.verbose,
      },
    );

    const frontendProbe = await waitForOperationOrStop(waitForProbe({
      label: 'Vite frontend /',
      processInfo: frontendProcess,
      timeoutMs: config.startupTimeoutMs,
      probe: () => checkFrontendHtml(plan.urls.frontend, config.requestTimeoutMs),
    }), stopController);
    if (frontendProbe.stopped) {
      return;
    }

    io.log(formatSummary(buildReadySummary(config, selectedPorts, plan, run), config));
    if (!config.jsonOnly) {
      io.log('Live observatory is running. Press Ctrl-C to stop both processes.');
    }

    const stopReason = await waitForStopSignalOrChildExit(stopController, apiProcess, frontendProcess);
    if (stopReason.kind === 'child-exit') {
      throw new Error(
        `${stopReason.label} exited while the observatory was running.` +
          outputSuffix(stopReason.processInfo),
      );
    }
  } finally {
    stopController.cleanup();
    const shutdown = {
      frontend: await stopChildProcess(frontendProcess, config.shutdownTimeoutMs),
      api: await stopChildProcess(apiProcess, config.shutdownTimeoutMs),
    };
    if (!config.dryRun && !config.jsonOnly) {
      io.log(`Shutdown: frontend=${shutdown.frontend.status}, api=${shutdown.api.status}`);
    }
  }
}

function buildLaunchPlan(config, selectedPorts, env = process.env) {
  const apiBaseUrl = `http://${config.host}:${selectedPorts.api.port}`;
  const frontendBaseUrl = `http://${config.host}:${selectedPorts.frontend.port}`;
  const apiArgs = [
    '-m',
    'server.app',
    '--host',
    config.host,
    '--port',
    String(selectedPorts.api.port),
    '--config',
    config.configPath,
    '--seed',
    String(config.seed),
    '--provider',
    config.provider,
    '--pace',
    String(config.pace),
    '--duration',
    String(config.duration),
    '--world-tick-interval',
    String(config.worldTickInterval),
    '--refresh-interval',
    String(config.refreshInterval),
    '--memory-root',
    config.memoryRoot,
    '--run-dir',
    config.runDir,
  ];
  if (config.model) {
    apiArgs.push('--model', config.model);
  }
  if (config.contextTokens !== null) {
    apiArgs.push('--context-tokens', String(config.contextTokens));
  }
  if (config.idle) {
    // --seed/--provider/--duration above are inert under --idle: the screen supplies
    // them. --memory-root/--run-dir still say where a screen-started run writes.
    apiArgs.push('--idle');
  }

  return {
    urls: {
      api: apiBaseUrl,
      frontend: frontendBaseUrl,
    },
    commands: {
      api: {
        label: 'production live API',
        command: env.PYTHON || 'python3',
        args: apiArgs,
      },
      frontend: {
        label: 'Vite frontend',
        command: npmCommand(),
        args: [
          '--prefix',
          'frontend',
          'run',
          'dev',
          '--',
          '--host',
          config.host,
          '--port',
          String(selectedPorts.frontend.port),
          '--strictPort',
        ],
        env: {
          VIVARIUM_API_TARGET: apiBaseUrl,
        },
      },
    },
  };
}

function createStopSignalController() {
  const listeners = [];
  let stopReason = null;
  let resolveStop;
  const promise = new Promise((resolve) => {
    resolveStop = resolve;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      if (!stopReason) {
        stopReason = { kind: 'signal', signal };
        resolveStop(stopReason);
      }
    };
    listeners.push({ signal, handler });
    process.once(signal, handler);
  }
  return {
    promise,
    get reason() {
      return stopReason;
    },
    cleanup() {
      for (const { signal, handler } of listeners) {
        process.off(signal, handler);
      }
    },
  };
}

async function waitForOperationOrStop(operationPromise, stopController) {
  const result = await Promise.race([
    operationPromise.then((value) => ({ kind: 'operation', value })),
    stopController.promise,
  ]);
  if (result.kind === 'signal') {
    return { stopped: true, reason: result };
  }
  return { stopped: false, value: result.value };
}

function buildDryRunSummary(config, selectedPorts, plan) {
  return {
    mode: 'live-observatory',
    dry_run: true,
    deterministic: false,
    real_live: true,
    provider: config.provider,
    model: config.model || 'default',
    seed: config.seed,
    duration_seconds: config.duration,
    ports: portSummary(selectedPorts),
    urls: plan.urls,
    external_smoke_env: externalSmokeEnv(plan),
    commands: plan.commands,
    checks: {
      ports_available: true,
      api_target: plan.commands.frontend.env.VIVARIUM_API_TARGET,
      starts_production_api: plan.commands.api.args.includes('server.app'),
      starts_deterministic_test_api: plan.commands.api.args.includes('tests.frontend_live.live_api_server'),
      uses_deterministic_mechanics_route: false,
      sets_external_smoke_env: false,
    },
  };
}

function buildReadySummary(config, selectedPorts, plan, run) {
  // Under --idle the API starts NO run, so the provider/model/seed/duration this
  // launcher holds are inert -- the browser's configuration screen chooses them. They
  // are reported as null rather than echoed, because printing the CLI's unused
  // defaults beside `run_status: "ready"` would describe a run that does not exist.
  return {
    mode: 'live-observatory',
    dry_run: false,
    deterministic: false,
    real_live: true,
    idle: config.idle,
    provider: config.idle ? null : config.provider,
    model: config.idle ? null : (config.model || 'default'),
    seed: config.idle ? null : config.seed,
    duration_seconds: config.idle ? null : config.duration,
    ports: portSummary(selectedPorts),
    urls: plan.urls,
    external_smoke_env: externalSmokeEnv(plan),
    checks: {
      api_run: 'ok',
      frontend_html: 'ok',
      run_status: run.status,
      event_cursor: run.eventCursor,
      api_target: plan.commands.frontend.env.VIVARIUM_API_TARGET,
    },
  };
}

function externalSmokeEnv(plan) {
  return {
    VIVARIUM_REAL_LIVE: '1',
    VIVARIUM_REAL_LIVE_FRONTEND_URL: plan.urls.frontend,
    VIVARIUM_REAL_LIVE_API_URL: plan.urls.api,
  };
}

function portSummary(selectedPorts) {
  return {
    api: {
      mode: selectedPorts.api.mode === 'explicit' ? 'explicit' : 'auto-selected',
      port: selectedPorts.api.port,
    },
    frontend: {
      mode: selectedPorts.frontend.mode === 'explicit' ? 'explicit' : 'auto-selected',
      port: selectedPorts.frontend.port,
    },
  };
}

async function checkRun(baseUrl, requestTimeoutMs, expectedStatus = 'running') {
  const body = await fetchJson(joinUrl(baseUrl, '/api/run'), {
    label: 'production API /api/run',
    requestTimeoutMs,
  });
  requireSchema(body, 'production API /api/run');
  if (body.status !== expectedStatus) {
    throw new Error(
      `production API /api/run status must be ${formatValue(expectedStatus)}; ` +
        `received ${formatValue(body.status)}.`,
    );
  }
  return {
    status: body.status,
    eventCursor: requireNonNegativeCursor(body.event_cursor, 'production API /api/run event_cursor'),
  };
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

async function fetchJson(url, { label, requestTimeoutMs }) {
  const response = await fetchWithTimeout(url, {
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

function requireSchema(body, label) {
  if (body.schema !== 1) {
    throw new Error(`${label} schema must be 1; received ${formatValue(body.schema)}.`);
  }
}

function requireNonNegativeCursor(value, label) {
  if (!(Number.isInteger(value) && value >= 0)) {
    throw new Error(`${label} must be an integer >= 0; received ${formatValue(value)}.`);
  }
  return value;
}

function parseCliArgs(argv, env) {
  const config = {
    host: stringSetting(env.VIVARIUM_OBSERVATORY_HOST, defaultHost),
    apiPort: parsePortSetting(
      env.VIVARIUM_OBSERVATORY_API_PORT ?? 'auto',
      'VIVARIUM_OBSERVATORY_API_PORT',
    ),
    frontendPort: parsePortSetting(
      env.VIVARIUM_OBSERVATORY_FRONTEND_PORT ?? 'auto',
      'VIVARIUM_OBSERVATORY_FRONTEND_PORT',
    ),
    configPath: stringSetting(env.VIVARIUM_OBSERVATORY_CONFIG, defaultConfigPath),
    seed: positiveInteger(env.VIVARIUM_OBSERVATORY_SEED, defaultSeed, 'VIVARIUM_OBSERVATORY_SEED'),
    provider: stringSetting(env.VIVARIUM_OBSERVATORY_PROVIDER, defaultProvider),
    model: optionalString(env.VIVARIUM_OBSERVATORY_MODEL),
    contextTokens: optionalPositiveInteger(
      env.VIVARIUM_OBSERVATORY_CONTEXT_TOKENS,
      'VIVARIUM_OBSERVATORY_CONTEXT_TOKENS',
    ),
    pace: positiveNumber(env.VIVARIUM_OBSERVATORY_PACE, defaultPace, 'VIVARIUM_OBSERVATORY_PACE'),
    duration: positiveNumber(
      env.VIVARIUM_OBSERVATORY_DURATION,
      defaultDuration,
      'VIVARIUM_OBSERVATORY_DURATION',
    ),
    worldTickInterval: positiveNumber(
      env.VIVARIUM_OBSERVATORY_WORLD_TICK_INTERVAL,
      defaultWorldTickInterval,
      'VIVARIUM_OBSERVATORY_WORLD_TICK_INTERVAL',
    ),
    refreshInterval: positiveNumber(
      env.VIVARIUM_OBSERVATORY_REFRESH_INTERVAL,
      defaultRefreshInterval,
      'VIVARIUM_OBSERVATORY_REFRESH_INTERVAL',
    ),
    memoryRoot: stringSetting(env.VIVARIUM_OBSERVATORY_MEMORY_ROOT, defaultMemoryRoot),
    runDir: stringSetting(env.VIVARIUM_OBSERVATORY_RUN_DIR, defaultRunDir),
    startupTimeoutMs: positiveInteger(
      env.VIVARIUM_OBSERVATORY_STARTUP_TIMEOUT_MS,
      defaultStartupTimeoutMs,
      'VIVARIUM_OBSERVATORY_STARTUP_TIMEOUT_MS',
    ),
    shutdownTimeoutMs: positiveInteger(
      env.VIVARIUM_OBSERVATORY_SHUTDOWN_TIMEOUT_MS,
      defaultShutdownTimeoutMs,
      'VIVARIUM_OBSERVATORY_SHUTDOWN_TIMEOUT_MS',
    ),
    requestTimeoutMs: positiveInteger(
      env.VIVARIUM_OBSERVATORY_REQUEST_TIMEOUT_MS,
      defaultRequestTimeoutMs,
      'VIVARIUM_OBSERVATORY_REQUEST_TIMEOUT_MS',
    ),
    dryRun: env.VIVARIUM_OBSERVATORY_DRY_RUN === '1',
    jsonOnly: env.VIVARIUM_OBSERVATORY_JSON === '1',
    verbose: env.VIVARIUM_OBSERVATORY_VERBOSE === '1',
    // Boot the API with no run at all, so the browser's configuration screen starts
    // the FIRST world from its own knobs rather than replacing one the CLI chose.
    idle: env.VIVARIUM_OBSERVATORY_IDLE === '1',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      config.help = true;
      continue;
    }
    if (arg === '--dry-run') {
      config.dryRun = true;
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
    if (arg === '--idle') {
      config.idle = true;
      continue;
    }

    const parsedFlag = parseFlagValue(argv, index);
    if (parsedFlag.consumed === 0) {
      throw new Error(`Unknown argument ${formatValue(arg)}.`);
    }
    index += parsedFlag.consumed - 1;

    switch (parsedFlag.name) {
      case '--host':
        config.host = stringSetting(parsedFlag.value, defaultHost);
        break;
      case '--api-port':
        config.apiPort = parsePortSetting(parsedFlag.value, '--api-port');
        break;
      case '--frontend-port':
        config.frontendPort = parsePortSetting(parsedFlag.value, '--frontend-port');
        break;
      case '--config':
        config.configPath = stringSetting(parsedFlag.value, defaultConfigPath);
        break;
      case '--seed':
        config.seed = positiveInteger(parsedFlag.value, defaultSeed, '--seed');
        break;
      case '--provider':
        config.provider = stringSetting(parsedFlag.value, defaultProvider);
        break;
      case '--model':
        config.model = optionalString(parsedFlag.value);
        break;
      case '--context-tokens':
        config.contextTokens = optionalPositiveInteger(parsedFlag.value, '--context-tokens');
        break;
      case '--pace':
        config.pace = positiveNumber(parsedFlag.value, defaultPace, '--pace');
        break;
      case '--duration':
        config.duration = positiveNumber(parsedFlag.value, defaultDuration, '--duration');
        break;
      case '--world-tick-interval':
        config.worldTickInterval = positiveNumber(
          parsedFlag.value,
          defaultWorldTickInterval,
          '--world-tick-interval',
        );
        break;
      case '--refresh-interval':
        config.refreshInterval = positiveNumber(
          parsedFlag.value,
          defaultRefreshInterval,
          '--refresh-interval',
        );
        break;
      case '--memory-root':
        config.memoryRoot = stringSetting(parsedFlag.value, defaultMemoryRoot);
        break;
      case '--run-dir':
        config.runDir = stringSetting(parsedFlag.value, defaultRunDir);
        break;
      case '--startup-timeout-ms':
        config.startupTimeoutMs = positiveInteger(
          parsedFlag.value,
          defaultStartupTimeoutMs,
          '--startup-timeout-ms',
        );
        break;
      case '--shutdown-timeout-ms':
        config.shutdownTimeoutMs = positiveInteger(
          parsedFlag.value,
          defaultShutdownTimeoutMs,
          '--shutdown-timeout-ms',
        );
        break;
      case '--request-timeout-ms':
        config.requestTimeoutMs = positiveInteger(
          parsedFlag.value,
          defaultRequestTimeoutMs,
          '--request-timeout-ms',
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
    '--host',
    '--api-port',
    '--frontend-port',
    '--config',
    '--seed',
    '--provider',
    '--model',
    '--context-tokens',
    '--pace',
    '--duration',
    '--world-tick-interval',
    '--refresh-interval',
    '--memory-root',
    '--run-dir',
    '--startup-timeout-ms',
    '--shutdown-timeout-ms',
    '--request-timeout-ms',
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

function optionalPositiveInteger(value, label) {
  const raw = trimValue(value);
  if (raw === '') {
    return null;
  }
  return positiveInteger(raw, null, label);
}

function positiveNumber(value, fallback, label) {
  const raw = trimValue(value);
  if (raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return parsed;
}

function stringSetting(value, fallback) {
  const raw = trimValue(value);
  return raw === '' ? fallback : raw;
}

function optionalString(value) {
  const raw = trimValue(value);
  return raw === '' ? null : raw;
}

async function selectPorts(config) {
  const reserved = new Set();
  const api = await resolvePort(config.apiPort, reserved, config.host);
  reserved.add(api.port);
  const frontend = await resolvePort(config.frontendPort, reserved, config.host);
  if (api.port === frontend.port) {
    throw new Error('API and frontend ports must be different.');
  }
  return { api, frontend };
}

async function resolvePort(setting, reserved, host) {
  if (setting.mode === 'explicit') {
    if (reserved.has(setting.port)) {
      throw new Error(`${setting.label} must not reuse another selected port.`);
    }
    return { mode: 'explicit', port: setting.port };
  }
  return { mode: 'auto', port: await findOpenPort(reserved, host) };
}

async function findOpenPort(reserved, host) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await listenOnPort(0, host);
    if (!reserved.has(port)) {
      return port;
    }
  }
  throw new Error('Could not auto-select distinct local ports.');
}

async function assertPortAvailable(port, label, host = defaultHost) {
  try {
    await listenOnPort(port, host);
  } catch (error) {
    throw new Error(`${label} port ${port} is not available: ${error.message}`);
  }
}

function listenOnPort(port, host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      const selectedPort = address && typeof address === 'object' ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!selectedPort) {
          reject(new Error('Port selection did not return a TCP port.'));
          return;
        }
        resolve(selectedPort);
      });
    });
  });
}

function startChildProcess(label, command, args, { env, verbose }) {
  const output = createOutputBuffer();
  const detached = false;
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

function waitForStopSignalOrChildExit(stopController, apiProcess, frontendProcess) {
  return Promise.race([
    stopController.promise,
    apiProcess.exitPromise.then(() => ({
      kind: 'child-exit',
      label: apiProcess.label,
      processInfo: apiProcess,
    })),
    frontendProcess.exitPromise.then(() => ({
      kind: 'child-exit',
      label: frontendProcess.label,
      processInfo: frontendProcess,
    })),
  ]);
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

function formatSummary(summary, config = {}) {
  const json = JSON.stringify(summary, null, 2);
  if (config.jsonOnly) {
    return json;
  }
  return `${summary.dry_run ? 'Live observatory dry run' : 'Live observatory ready'}\n${json}`;
}

function requireFetch() {
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') {
    throw new Error('This launcher requires Node with global fetch and AbortController support.');
  }
}

function joinUrl(baseUrl, pathSuffix) {
  return `${baseUrl.replace(/\/+$/, '')}${pathSuffix}`;
}

function trimValue(value) {
  return (value === undefined || value === null ? '' : String(value)).trim();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isHtmlish(contentType, text) {
  return (
    /\bhtml\b/i.test(contentType || '') ||
    /<!doctype\s+html/i.test(text) ||
    /<html[\s>]/i.test(text) ||
    /<body[\s>]/i.test(text)
  );
}

function formatValue(value) {
  return JSON.stringify(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function usage() {
  return [
    'Usage: npm run dev:observatory -- [options]',
    '',
    'Starts the production Vivarium live API and the Vite frontend for a real local',
    'observatory session. This is not the deterministic test handoff and not the',
    'external real-provider Playwright smoke.',
    '',
    'Options:',
    '  --api-port <port|auto>          API port, default auto.',
    '  --frontend-port <port|auto>     Frontend port, default auto.',
    '  --host <host>                   Bind host, default 127.0.0.1.',
    '  --provider <mlx|ollama|gemini>  Provider passed to server.app, default mlx.',
    '  --model <name>                  Optional model override.',
    '  --context-tokens <count>        Optional provider context-token override.',
    '  --seed <number>                 Run seed, default 7.',
    '  --duration <seconds>            Run duration, default 1800.',
    '  --pace <seconds>                Agent pace, default 1.',
    '  --world-tick-interval <seconds> World tick interval, default 5.',
    '  --refresh-interval <seconds>    Refresh interval, default 2.',
    '  --config <path>                 World config path, default config/world.yaml.',
    '  --memory-root <path>            Memory root, default runs/memory.',
    '  --run-dir <path>                Run artifact directory, default runs.',
    '  --idle                          Start the API with NO run: it reports "ready" and',
    '                                  the browser configuration screen starts the first',
    '                                  world. Seed/provider/duration flags are then unused.',
    '  --dry-run                       Validate ports and print commands without spawning.',
    '  --json                          Print JSON only.',
    '  --verbose                       Pipe child stdout/stderr through.',
  ].join('\n');
}

module.exports = {
  main,
  _test: {
    assertPortAvailable,
    buildDryRunSummary,
    buildLaunchPlan,
    createStopSignalController,
    buildReadySummary,
    formatSummary,
    parseCliArgs,
    parsePortSetting,
    selectPorts,
  },
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`FAIL live observatory launcher: ${error.message}`);
    process.exit(1);
  });
}
