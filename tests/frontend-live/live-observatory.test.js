#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const test = require('node:test');

const { main, _test } = require('../../scripts/live-observatory');

test('parseCliArgs defaults observatory ports to auto and real provider defaults', () => {
  const config = _test.parseCliArgs([], {});

  assert.deepEqual(config.apiPort, {
    mode: 'auto',
    port: null,
    label: 'VIVARIUM_OBSERVATORY_API_PORT',
  });
  assert.deepEqual(config.frontendPort, {
    mode: 'auto',
    port: null,
    label: 'VIVARIUM_OBSERVATORY_FRONTEND_PORT',
  });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.provider, 'mlx');
  assert.equal(config.model, null);
  assert.equal(config.seed, 7);
  assert.equal(config.duration, 1800);
  assert.equal(config.dryRun, false);
  assert.equal(config.jsonOnly, false);
});

test('parseCliArgs lets flags override observatory env defaults', () => {
  const config = _test.parseCliArgs(
    [
      '--api-port=auto',
      '--frontend-port',
      '19175',
      '--provider',
      'ollama',
      '--model',
      'qwen3:8b',
      '--duration',
      '2400',
      '--context-tokens',
      '32768',
      '--json',
    ],
    {
      VIVARIUM_OBSERVATORY_API_PORT: '8000',
      VIVARIUM_OBSERVATORY_FRONTEND_PORT: '5173',
      VIVARIUM_OBSERVATORY_PROVIDER: 'gemini',
      VIVARIUM_OBSERVATORY_MODEL: 'gemini-test',
      VIVARIUM_OBSERVATORY_DURATION: '60',
    },
  );

  assert.deepEqual(config.apiPort, {
    mode: 'auto',
    port: null,
    label: '--api-port',
  });
  assert.deepEqual(config.frontendPort, {
    mode: 'explicit',
    port: 19175,
    label: '--frontend-port',
  });
  assert.equal(config.provider, 'ollama');
  assert.equal(config.model, 'qwen3:8b');
  assert.equal(config.duration, 2400);
  assert.equal(config.contextTokens, 32768);
  assert.equal(config.jsonOnly, true);
});

test('parsePortSetting and selectPorts reject invalid or duplicate ports', async () => {
  assert.throws(
    () => _test.parsePortSetting('65536', 'port'),
    /must be a TCP port/,
  );
  assert.throws(
    () => _test.parsePortSetting('soon', 'port'),
    /must be a TCP port/,
  );
  assert.deepEqual(_test.parsePortSetting('0', 'port'), {
    mode: 'auto',
    port: null,
    label: 'port',
  });

  const duplicateConfig = _test.parseCliArgs(
    ['--api-port', '18080', '--frontend-port', '18080'],
    {},
  );
  await assert.rejects(
    () => _test.selectPorts(duplicateConfig),
    /must not reuse another selected port|must be different/,
  );
});

test('assertPortAvailable rejects occupied local ports', async () => {
  const server = await listenOnEphemeralPort();
  try {
    await assert.rejects(
      () => _test.assertPortAvailable(server.port, 'API'),
      /API port \d+ is not available/,
    );
  } finally {
    await closeServer(server.server);
  }
});

test('buildLaunchPlan starts production server.app and Vite with API proxy env', () => {
  const config = _test.parseCliArgs(
    [
      '--api-port',
      '18001',
      '--frontend-port',
      '18002',
      '--host',
      '127.0.0.1',
      '--provider',
      'ollama',
      '--model',
      'qwen3:8b',
      '--seed',
      '9',
      '--duration',
      '1800',
      '--memory-root',
      '/tmp/vivarium-memory',
      '--run-dir',
      '/tmp/vivarium-runs',
    ],
    {},
  );
  const plan = _test.buildLaunchPlan(
    config,
    {
      api: { mode: 'explicit', port: 18001 },
      frontend: { mode: 'explicit', port: 18002 },
    },
    { PYTHON: 'python-test' },
  );

  assert.equal(plan.urls.api, 'http://127.0.0.1:18001');
  assert.equal(plan.urls.frontend, 'http://127.0.0.1:18002');
  assert.equal(plan.commands.api.command, 'python-test');
  assert.deepEqual(plan.commands.api.args.slice(0, 2), ['-m', 'server.app']);
  assert.equal(plan.commands.api.args.includes('tests.frontend_live.live_api_server'), false);
  assert.equal(plan.commands.api.args.includes('--log-level'), false);
  assert.match(plan.commands.api.args.join(' '), /--provider ollama/);
  assert.match(plan.commands.api.args.join(' '), /--model qwen3:8b/);
  assert.match(plan.commands.api.args.join(' '), /--memory-root \/tmp\/vivarium-memory/);
  assert.match(plan.commands.api.args.join(' '), /--run-dir \/tmp\/vivarium-runs/);

  assert.deepEqual(plan.commands.frontend.args.slice(0, 5), [
    '--prefix',
    'frontend',
    'run',
    'dev',
    '--',
  ]);
  assert.equal(plan.commands.frontend.args.includes('--strictPort'), true);
  assert.deepEqual(plan.commands.frontend.env, {
    VIVARIUM_API_TARGET: 'http://127.0.0.1:18001',
  });
});

test('dry-run summary is explicit that it is real-provider operation, not a smoke', () => {
  const config = _test.parseCliArgs(
    ['--api-port', '18011', '--frontend-port', '18012', '--dry-run'],
    {},
  );
  const selectedPorts = {
    api: { mode: 'explicit', port: 18011 },
    frontend: { mode: 'explicit', port: 18012 },
  };
  const plan = _test.buildLaunchPlan(config, selectedPorts, {});
  const summary = _test.buildDryRunSummary(config, selectedPorts, plan);

  assert.equal(summary.mode, 'live-observatory');
  assert.equal(summary.dry_run, true);
  assert.equal(summary.deterministic, false);
  assert.equal(summary.real_live, true);
  assert.equal(summary.checks.starts_production_api, true);
  assert.equal(summary.checks.starts_deterministic_test_api, false);
  assert.equal(summary.checks.uses_deterministic_mechanics_route, false);
  assert.equal(summary.checks.sets_external_smoke_env, false);
  assert.deepEqual(summary.external_smoke_env, {
    VIVARIUM_REAL_LIVE: '1',
    VIVARIUM_REAL_LIVE_FRONTEND_URL: 'http://127.0.0.1:18012',
    VIVARIUM_REAL_LIVE_API_URL: 'http://127.0.0.1:18011',
  });

  const rendered = _test.formatSummary(summary);
  assert.match(rendered, /^Live observatory dry run\n\{/);
  assert.doesNotMatch(rendered, /PASS .*smoke/i);
  assert.doesNotMatch(rendered, /api\/test\/mechanics\/run/);
  assert.doesNotMatch(rendered, /The springs are awake/);
});

test('main dry-run json prints commands and spawns no live services', async () => {
  const logs = [];
  await main(['--dry-run', '--json', '--api-port=auto', '--frontend-port=auto'], {}, {
    log(value) {
      logs.push(value);
    },
  });

  assert.equal(logs.length, 1);
  const summary = JSON.parse(logs[0]);
  assert.equal(summary.mode, 'live-observatory');
  assert.equal(summary.dry_run, true);
  assert.equal(summary.ports.api.mode, 'auto-selected');
  assert.equal(summary.ports.frontend.mode, 'auto-selected');
  assert.notEqual(summary.ports.api.port, summary.ports.frontend.port);
  assert.equal(summary.commands.api.args[1], 'server.app');
  assert.equal(summary.commands.frontend.env.VIVARIUM_API_TARGET, summary.urls.api);
  assert.deepEqual(summary.external_smoke_env, {
    VIVARIUM_REAL_LIVE: '1',
    VIVARIUM_REAL_LIVE_FRONTEND_URL: summary.urls.frontend,
    VIVARIUM_REAL_LIVE_API_URL: summary.urls.api,
  });
  assert.equal(summary.checks.starts_deterministic_test_api, false);
});

test('stop signal controller resolves before children are spawned', async () => {
  const controller = _test.createStopSignalController();
  try {
    process.emit('SIGINT');
    const reason = await controller.promise;
    assert.deepEqual(reason, { kind: 'signal', signal: 'SIGINT' });
    assert.deepEqual(controller.reason, { kind: 'signal', signal: 'SIGINT' });
  } finally {
    controller.cleanup();
  }
});

test('ready summary stays bounded and does not expose raw run ids or event prose', () => {
  const config = _test.parseCliArgs(
    ['--api-port', '18101', '--frontend-port', '18102'],
    {},
  );
  const selectedPorts = {
    api: { mode: 'explicit', port: 18101 },
    frontend: { mode: 'explicit', port: 18102 },
  };
  const plan = _test.buildLaunchPlan(config, selectedPorts, {});
  const summary = _test.buildReadySummary(config, selectedPorts, plan, {
    status: 'running',
    eventCursor: 7,
  });
  const rendered = _test.formatSummary(summary);

  assert.equal(summary.checks.api_run, 'ok');
  assert.equal(summary.checks.frontend_html, 'ok');
  assert.equal(summary.checks.api_target, 'http://127.0.0.1:18101');
  assert.doesNotMatch(rendered, /seed-7-/);
  assert.doesNotMatch(rendered, /message|payload|The springs are awake/i);
});

function listenOnEphemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

test('buildLaunchPlan --idle boots the API with no run so the screen starts the first one', () => {
  const ports = {
    api: { mode: 'explicit', port: 18001 },
    frontend: { mode: 'explicit', port: 18002 },
  };
  const idle = _test.buildLaunchPlan(
    _test.parseCliArgs(['--idle'], {}),
    ports,
    { PYTHON: 'python-test' },
  );
  assert.equal(idle.commands.api.args.includes('--idle'), true);
  assert.deepEqual(idle.commands.api.args.slice(0, 2), ['-m', 'server.app']);

  const autostarting = _test.buildLaunchPlan(
    _test.parseCliArgs([], {}),
    ports,
    { PYTHON: 'python-test' },
  );
  assert.equal(autostarting.commands.api.args.includes('--idle'), false);
});

test('ready summary under --idle reports no run knobs, because the browser chooses them', () => {
  const selectedPorts = {
    api: { mode: 'explicit', port: 18101 },
    frontend: { mode: 'explicit', port: 18102 },
  };
  const config = _test.parseCliArgs(['--idle'], {});
  const plan = _test.buildLaunchPlan(config, selectedPorts, {});
  const summary = _test.buildReadySummary(config, selectedPorts, plan, {
    status: 'ready',
    eventCursor: 0,
  });

  assert.equal(summary.idle, true);
  assert.equal(summary.checks.run_status, 'ready');
  assert.equal(summary.provider, null);
  assert.equal(summary.seed, null);
  assert.equal(summary.duration_seconds, null);

  const autostarting = _test.parseCliArgs([], {});
  const autostartingSummary = _test.buildReadySummary(
    autostarting,
    selectedPorts,
    _test.buildLaunchPlan(autostarting, selectedPorts, {}),
    { status: 'running', eventCursor: 7 },
  );
  assert.equal(autostartingSummary.idle, false);
  assert.equal(autostartingSummary.provider, autostarting.provider);
  assert.equal(autostartingSummary.seed, autostarting.seed);
});
