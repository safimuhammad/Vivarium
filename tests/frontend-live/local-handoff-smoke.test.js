#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const test = require('node:test');

const { _test } = require('./local-handoff-smoke');

test('parseCliArgs defaults both local handoff ports to auto', () => {
  const config = _test.parseCliArgs([], {});

  assert.deepEqual(config.apiPort, {
    mode: 'auto',
    port: null,
    label: 'VIVARIUM_LOCAL_HANDOFF_API_PORT',
  });
  assert.deepEqual(config.frontendPort, {
    mode: 'auto',
    port: null,
    label: 'VIVARIUM_LOCAL_HANDOFF_FRONTEND_PORT',
  });
  assert.equal(config.requestTimeoutMs, 10000);
  assert.equal(config.startupTimeoutMs, 45000);
  assert.equal(config.jsonOnly, false);
});

test('parseCliArgs accepts env and flag port overrides', () => {
  const config = _test.parseCliArgs(
    ['--frontend-port', '19175', '--api-port=19021', '--json'],
    {
      VIVARIUM_LOCAL_HANDOFF_API_PORT: 'auto',
      VIVARIUM_LOCAL_HANDOFF_FRONTEND_PORT: '19099',
      VIVARIUM_LOCAL_HANDOFF_REQUEST_TIMEOUT_MS: '3000',
    },
  );

  assert.deepEqual(config.apiPort, {
    mode: 'explicit',
    port: 19021,
    label: '--api-port',
  });
  assert.deepEqual(config.frontendPort, {
    mode: 'explicit',
    port: 19175,
    label: '--frontend-port',
  });
  assert.equal(config.requestTimeoutMs, 3000);
  assert.equal(config.jsonOnly, true);
});

test('parsePortSetting rejects invalid explicit ports', () => {
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

test('run, world, and run-id validators enforce the local API contract', () => {
  assert.deepEqual(
    _test.validateRunEnvelope(baseRun(), 'direct API /api/run'),
    { ok: true, runId: 'seed-7-test', eventCursor: 3 },
  );
  assert.deepEqual(
    _test.validateWorldEnvelope(baseWorld(), 'proxied /api/world', 'seed-7-test'),
    { ok: true, runId: 'seed-7-test', eventCursor: 5 },
  );
  assert.throws(
    () => _test.validateRunEnvelope({ ...baseRun(), status: 'stopped' }, 'direct API /api/run'),
    /status must be "running"/,
  );
  assert.throws(
    () => _test.validateWorldEnvelope(baseWorld(), 'proxied /api/world', 'other-run'),
    /does not match/,
  );
  assert.throws(
    () => _test.requireEqualRunIds('direct-run', 'proxied-run'),
    /does not match proxied run_id/,
  );
});

test('parseOneSseEnvelope accepts one-shot SSE event envelopes', () => {
  const envelope = _test.parseOneSseEnvelope(
    'event: events\ndata: {"schema":1,\ndata: "next_cursor":9,"events":[{"cursor":1}]}\n\n',
    'proxied one-shot SSE',
  );

  assert.deepEqual(envelope, {
    schema: 1,
    next_cursor: 9,
    events: [{ cursor: 1 }],
  });
  assert.deepEqual(
    _test.validateSseEnvelope(envelope, 'proxied one-shot SSE'),
    { ok: true, nextCursor: 9, eventCount: 1 },
  );
});

test('parseOneSseEnvelope rejects empty or malformed SSE without echoing payloads', () => {
  assert.throws(
    () => _test.parseOneSseEnvelope('event: ping\nid: 1\n\n', 'direct API one-shot SSE'),
    /returned no SSE envelope data/,
  );
  assert.throws(
    () => _test.parseOneSseEnvelope('data: {"schema":1,"next_cursor":\n\n', 'direct API one-shot SSE'),
    /invalid JSON event data/,
  );
  assert.throws(
    () => _test.validateSseEnvelope({ schema: 1, next_cursor: 0, events: [] }, 'direct API one-shot SSE'),
    /next_cursor must be an integer > 0/,
  );
});

test('validateMechanicsEnvelope summarizes deterministic mechanics without rerunning servers', () => {
  const result = _test.validateMechanicsEnvelope(baseMechanics(), '/api/test/mechanics/run');

  assert.deepEqual(result, {
    ok: true,
    startCursor: 10,
    endCursor: 44,
    eventTypeCount: 27,
    emittedEventCount: 34,
    toolCount: 24,
  });
  assert.throws(
    () => _test.validateMechanicsEnvelope(
      {
        ...baseMechanics(),
        tools: [
          { tool: 'attack', ok: false },
          ...Array.from({ length: 23 }, (_, index) => ({ tool: `tool_${index}`, ok: true })),
        ],
      },
      '/api/test/mechanics/run',
    ),
    /reported 1 failed tool outcome/,
  );
  assert.throws(
    () => _test.validateMechanicsEnvelope(
      {
        ...baseMechanics(),
        end_cursor: 10,
      },
      '/api/test/mechanics/run',
    ),
    /end_cursor must be greater than start_cursor/,
  );
  assert.throws(
    () => _test.validateMechanicsEnvelope(
      {
        schema: 1,
        version: 'fake-harness',
        newly_ran: true,
        reused_cached_result: false,
        start_cursor: 1,
        end_cursor: 3,
        event_types: ['speak'],
        tools: [{ tool: 'speak', ok: true }],
      },
      '/api/test/mechanics/run',
    ),
    /version must be/,
  );
  assert.throws(
    () => _test.validateMechanicsEnvelope(
      {
        ...baseMechanics(),
        event_types: ['speak'],
        tools: Array.from({ length: 24 }, (_, index) => ({ tool: `tool_${index}`, ok: true })),
      },
      '/api/test/mechanics/run',
    ),
    /at least 27 unique event types/,
  );
});

test('buildSummary reports deterministic handoff ports, cursors, and shutdown status', () => {
  const summary = _test.buildSummary(
    {
      directRun: { ok: true, runId: 'seed-7-test', eventCursor: 12 },
      directWorld: { ok: true, eventCursor: 12 },
      directSse: { ok: true, nextCursor: 16, eventCount: 4 },
      frontendHtml: { ok: true },
      proxiedRun: { ok: true, runId: 'seed-7-test', eventCursor: 13 },
      proxiedWorld: { ok: true, eventCursor: 14 },
      proxiedSse: { ok: true, nextCursor: 17, eventCount: 5 },
      mechanics: {
        ok: true,
        startCursor: 10,
        endCursor: 18,
        eventTypeCount: 27,
        emittedEventCount: 34,
        toolCount: 24,
      },
      postMechanicsWorld: { eventCursor: 18 },
    },
    {
      api: { mode: 'auto', port: 52341 },
      frontend: { mode: 'explicit', port: 19175 },
    },
    {
      api: { status: 'terminated', exit_code: 0, signal: null },
      frontend: { status: 'terminated', exit_code: null, signal: 'SIGTERM' },
    },
  );

  assert.equal(summary.mode, 'deterministic-local-handoff');
  assert.equal(summary.real_live, false);
  assert.deepEqual(summary.ports, {
    api: { mode: 'auto-selected', port: 52341 },
    frontend: { mode: 'explicit', port: 19175 },
  });
  assert.deepEqual(summary.run, {
    run_id_matched: true,
    direct_event_cursor: 12,
    proxied_event_cursor: 13,
    direct_world_event_cursor: 12,
    proxied_world_event_cursor: 14,
  });
  assert.deepEqual(summary.sse, {
    direct_next_cursor: 16,
    direct_event_count: 4,
    proxied_next_cursor: 17,
    proxied_event_count: 5,
  });
  assert.equal(summary.checks.post_mechanics_world_cursor, 'ok');
  assert.equal(summary.mechanics.start_cursor, 10);
  assert.equal(summary.mechanics.end_cursor, 18);
  assert.equal(summary.mechanics.event_type_count, 27);
  assert.equal(summary.mechanics.emitted_event_count, 34);
  assert.equal(summary.mechanics.post_world_cursor, 18);
  assert.equal(summary.mechanics.post_world_cursor_covers_mechanics, true);
  assert.equal(summary.shutdown.api.status, 'terminated');
  assert.equal(summary.shutdown.frontend.signal, 'SIGTERM');

  const rendered = _test.formatSummary(summary);
  assert.match(rendered, /^PASS deterministic local handoff smoke\n\{/);
  assert.doesNotMatch(rendered, /seed-7-test/);
  assert.match(rendered, /52341/);
  assert.match(rendered, /19175/);
  assert.match(rendered, /start_cursor/);
  assert.match(rendered, /end_cursor/);
  assert.match(rendered, /run_id_matched/);
});

function baseRun() {
  return {
    schema: 1,
    run_id: 'seed-7-test',
    status: 'running',
    event_cursor: 3,
  };
}

function baseWorld() {
  return {
    schema: 1,
    run_id: 'seed-7-test',
    event_cursor: 5,
    agents: [{ id: 'wanderer_001' }],
    regions: [{ name: 'warm_springs' }],
  };
}

function baseMechanics() {
  return {
    schema: 1,
    version: 'layer-22b-live-mechanics-v3',
    newly_ran: true,
    reused_cached_result: false,
    start_cursor: 10,
    end_cursor: 44,
    event_types: [
      ...mechanicsEventTypes(),
      'mating_initiated',
      'mating_initiated',
      'mating_initiated',
      'mating_initiated',
      'resource_changed',
      'home_breached',
      'agent_born',
    ],
    tools: Array.from({ length: 24 }, (_, index) => ({
      tool: `tool_${index}`,
      ok: true,
    })),
  };
}

function mechanicsEventTypes() {
  return [
    'agent_decayed',
    'agent_died',
    'agent_entered_region',
    'agent_left_region',
    'agent_paralyzed',
    'agent_recovered',
    'agent_started_hoarding',
    'agent_born',
    'attack',
    'hearth_used',
    'home_breached',
    'home_built',
    'home_collapsed',
    'home_colonized',
    'home_joined',
    'home_left',
    'home_started_hoarding',
    'home_thieved',
    'mating_initiated',
    'mating_proposal_invalidated',
    'mating_proposal_timeout',
    'mating_rejected',
    'resource_changed',
    'resource_transferred',
    'ruins_scavenged',
    'self_talk',
    'speak',
  ];
}

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
