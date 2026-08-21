#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { _test } = require('./preflight-real-provider-smoke');

const defaultOptions = {
  nowMs: 110000,
  requestTimeoutMs: 120000,
  runDurationMarginMs: 60000,
};

test('validateRunnableRun accepts a running run with enough remaining duration', () => {
  const result = _test.validateRunnableRun(baseRun(), 'frontend /api/run', defaultOptions);

  assert.equal(result.durationMs, 1800000);
  assert.equal(result.elapsedMs, 10000);
  assert.equal(result.remainingMs, 1790000);
});

test('validateRunnableRun rejects a stopped run', () => {
  assert.throws(
    () => _test.validateRunnableRun(baseRun({ status: 'stopped' }), 'frontend /api/run', defaultOptions),
    /status must be "running"/,
  );
});

test('validateRunnableRun requires timing duration metadata', () => {
  assert.throws(
    () => _test.validateRunnableRun(baseRun({ timing: undefined }), 'frontend /api/run', defaultOptions),
    /timing must be an object/,
  );
  assert.throws(
    () => _test.validateRunnableRun(baseRun({ timing: { duration: 'soon' } }), 'frontend /api/run', defaultOptions),
    /timing\.duration must be a positive number/,
  );
});

test('validateRunnableRun requires started_at metadata', () => {
  assert.throws(
    () => _test.validateRunnableRun(baseRun({ started_at: undefined }), 'frontend /api/run', defaultOptions),
    /started_at must be a positive epoch-seconds value/,
  );
});

test('validateRunnableRun rejects short or nearly expired runs', () => {
  assert.throws(
    () => _test.validateRunnableRun(baseRun({ timing: { duration: 120 } }), 'direct API /api/run', defaultOptions),
    /has only 110s of backend runtime remaining.*--duration at least 1800/s,
  );

  assert.throws(
    () => _test.validateRunnableRun(
      baseRun(),
      'frontend /api/run',
      { ...defaultOptions, nowMs: 1750000 },
    ),
    /has only 150s of backend runtime remaining.*--duration at least 1830/s,
  );
});

test('validateRunConstants accepts required positive timing constants', () => {
  assert.deepEqual(
    _test.validateRunConstants(baseRun(), 'frontend /api/run'),
    baseRunConstants(),
  );
});

test('validateRunConstants requires constants object', () => {
  assert.throws(
    () => _test.validateRunConstants(baseRun({ constants: undefined }), 'frontend /api/run'),
    /constants must be an object/,
  );
});

test('validateRunConstants requires each timing key', () => {
  for (const key of requiredRunConstantKeys()) {
    const constants = baseRunConstants();
    delete constants[key];

    assert.throws(
      () => _test.validateRunConstants(baseRun({ constants }), 'frontend /api/run'),
      new RegExp(`constants\\.${key} must be present`),
    );
  }
});

test('validateRunConstants rejects non-finite timing values', () => {
  for (const key of requiredRunConstantKeys()) {
    assert.throws(
      () => _test.validateRunConstants(
        baseRun({
          constants: {
            ...baseRunConstants(),
            [key]: Infinity,
          },
        }),
        'frontend /api/run',
      ),
      new RegExp(`constants\\.${key} must be a finite number > 0`),
    );
  }
});

test('validateRunConstants rejects non-positive timing values', () => {
  for (const key of requiredRunConstantKeys()) {
    assert.throws(
      () => _test.validateRunConstants(
        baseRun({
          constants: {
            ...baseRunConstants(),
            [key]: 0,
          },
        }),
        'frontend /api/run',
      ),
      new RegExp(`constants\\.${key} must be a finite number > 0`),
    );
  }
});

test('validateRunIdMatch keeps optional direct API comparison strict', () => {
  assert.equal(_test.validateRunIdMatch(null, { run_id: 'frontend-run' }), null);
  assert.equal(
    _test.validateRunIdMatch({ run_id: 'shared-run' }, { run_id: 'shared-run' }),
    null,
  );
  assert.match(
    _test.validateRunIdMatch({ run_id: 'api-run' }, { run_id: 'frontend-run' }),
    /Direct API run_id "api-run" does not match frontend \/api\/run run_id "frontend-run"/,
  );
});

test('checkDirectApiRun fetches direct /api/run and enforces constants', async (t) => {
  const calls = stubRunFetch(t, apiRun());

  const run = await _test.checkDirectApiRun('http://api.test/');

  assert.deepEqual(calls, [
    {
      url: 'http://api.test/api/run',
      accept: 'application/json',
    },
  ]);
  assert.equal(run.run_id, 'seed-7');
  assert.equal(run.constants.home_upkeep_materials_per_second, 0.2);
});

test('checkFrontendRun fetches proxied /api/run and enforces constants', async (t) => {
  const calls = stubRunFetch(t, apiRun({ run_id: 'frontend-seed' }));

  const run = await _test.checkFrontendRun('http://frontend.test');

  assert.deepEqual(calls, [
    {
      url: 'http://frontend.test/api/run',
      accept: 'application/json',
    },
  ]);
  assert.equal(run.run_id, 'frontend-seed');
  assert.equal(run.constants.ruins_persist_seconds, 120);
});

test('checkDirectApiRun fails when direct /api/run constants are missing', async (t) => {
  const errors = capturePreflightFailure(t);
  stubRunFetch(t, apiRun({ constants: undefined }));

  await assert.rejects(
    () => _test.checkDirectApiRun('http://api.test'),
    { exitCode: 1 },
  );
  assert.match(errors.join('\n'), /FAIL direct API \/api\/run constants must be an object/);
});

test('checkFrontendRun fails when proxied /api/run constants are invalid', async (t) => {
  const errors = capturePreflightFailure(t);
  stubRunFetch(t, apiRun({
    constants: {
      ...baseRunConstants(),
      ruins_persist_seconds: 0,
    },
  }));

  await assert.rejects(
    () => _test.checkFrontendRun('http://frontend.test'),
    { exitCode: 1 },
  );
  assert.match(
    errors.join('\n'),
    /FAIL frontend \/api\/run constants\.ruins_persist_seconds must be a finite number > 0/,
  );
});

test('parseOneSseEnvelope accepts a valid schema 1 cursor envelope', () => {
  assert.deepEqual(
    _test.parseOneSseEnvelope('event: message\ndata: {"schema":1,"next_cursor":7,"events":[]}\n\n'),
    { schema: 1, next_cursor: 7, events: [] },
  );
});

test('parseOneSseEnvelope combines multi-line SSE data payloads', () => {
  assert.deepEqual(
    _test.parseOneSseEnvelope('data: {"schema":1,\ndata: "next_cursor":8}\n\n'),
    { schema: 1, next_cursor: 8 },
  );
});

test('parseOneSseEnvelope rejects invalid JSON event data without echoing payload', () => {
  assert.throws(
    () => _test.parseOneSseEnvelope('data: {"schema":1,"next_cursor":\n\n'),
    /invalid JSON event data/,
  );
});

test('parseOneSseEnvelope rejects missing data payloads', () => {
  assert.throws(
    () => _test.parseOneSseEnvelope('event: ping\nid: 1\n\n'),
    /returned no SSE envelope data/,
  );
});

test('parseOneSseEnvelope rejects invalid schema and next_cursor', () => {
  assert.throws(
    () => _test.parseOneSseEnvelope('data: {"schema":2,"next_cursor":4}\n\n'),
    /schema must be 1/,
  );
  assert.throws(
    () => _test.parseOneSseEnvelope('data: {"schema":1,"next_cursor":0}\n\n'),
    /next_cursor must be a finite number > 0/,
  );
  assert.throws(
    () => _test.parseOneSseEnvelope('data: {"schema":1,"next_cursor":"4"}\n\n'),
    /next_cursor must be a finite number > 0/,
  );
});

test('checkFrontendEventStream fetches proxied one-shot SSE readiness', async (t) => {
  const calls = stubEventStreamFetch(t, {
    text: 'event: update\ndata: {"schema":1,"next_cursor":12,"events":[{"type":"ignored"}]}\n\n',
  });

  const envelope = await _test.checkFrontendEventStream('http://frontend.test/');

  assert.deepEqual(calls, [
    {
      url: 'http://frontend.test/api/events/stream?cursor=0&once=true',
      accept: 'text/event-stream',
    },
  ]);
  assert.equal(envelope.schema, 1);
  assert.equal(envelope.next_cursor, 12);
});

test('checkFrontendEventStream fails clearly on HTTP failure', async (t) => {
  const errors = capturePreflightFailure(t);
  stubEventStreamFetch(t, {
    status: 503,
    text: 'data: {"schema":1,"next_cursor":12}\n\n',
  });

  await assert.rejects(
    () => _test.checkFrontendEventStream('http://frontend.test'),
    { exitCode: 1 },
  );
  assert.match(
    errors.join('\n'),
    /FAIL frontend \/api\/events\/stream\?cursor=0&once=true returned HTTP 503; expected 2xx/,
  );
  assert.doesNotMatch(errors.join('\n'), /http:\/\/frontend\.test/);
});

test('checkFrontendEventStream fails clearly on non-SSE content type', async (t) => {
  const errors = capturePreflightFailure(t);
  stubEventStreamFetch(t, {
    contentType: 'application/json',
    text: '{"schema":1,"next_cursor":12}',
  });

  await assert.rejects(
    () => _test.checkFrontendEventStream('http://frontend.test'),
    { exitCode: 1 },
  );
  assert.match(
    errors.join('\n'),
    /FAIL frontend \/api\/events\/stream\?cursor=0&once=true returned non-SSE content-type "application\/json"/,
  );
});

test('checkFrontendEventStream fails clearly on invalid JSON event data', async (t) => {
  const errors = capturePreflightFailure(t);
  stubEventStreamFetch(t, {
    text: 'data: {"schema":1,"next_cursor":\n\n',
  });

  await assert.rejects(
    () => _test.checkFrontendEventStream('http://frontend.test'),
    { exitCode: 1 },
  );
  assert.match(
    errors.join('\n'),
    /FAIL frontend \/api\/events\/stream\?cursor=0&once=true returned invalid JSON event data/,
  );
  assert.doesNotMatch(errors.join('\n'), /next_cursor/);
});

test('checkFrontendEventStream fails clearly when no envelope data arrives', async (t) => {
  const errors = capturePreflightFailure(t);
  stubEventStreamFetch(t, {
    text: 'event: ping\nid: 1\n\n',
  });

  await assert.rejects(
    () => _test.checkFrontendEventStream('http://frontend.test'),
    { exitCode: 1 },
  );
  assert.match(
    errors.join('\n'),
    /FAIL frontend \/api\/events\/stream\?cursor=0&once=true returned no SSE envelope data/,
  );
});

test('checkFrontendEventStream aborts stalled SSE body reads', async (t) => {
  const errors = capturePreflightFailure(t);
  const aborts = [];
  t.mock.method(console, 'log', () => {});
  t.mock.method(globalThis, 'fetch', async (_url, fetchOptions = {}) => ({
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'text/event-stream' : null;
      },
    },
    text() {
      return new Promise((_resolve, reject) => {
        fetchOptions.signal.addEventListener('abort', () => {
          aborts.push(true);
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    },
  }));

  await assert.rejects(
    () => _test.checkFrontendEventStream('http://frontend.test', { requestTimeoutMs: 5 }),
    { exitCode: 1 },
  );

  assert.deepEqual(aborts, [true]);
  assert.match(
    errors.join('\n'),
    /FAIL \/api\/events\/stream\?cursor=0&once=true timed out after 5ms/,
  );
});

test('checkFrontendEventStream fails clearly on invalid stream envelope cursor', async (t) => {
  const errors = capturePreflightFailure(t);
  stubEventStreamFetch(t, {
    text: 'data: {"schema":1,"next_cursor":null}\n\n',
  });

  await assert.rejects(
    () => _test.checkFrontendEventStream('http://frontend.test'),
    { exitCode: 1 },
  );
  assert.match(
    errors.join('\n'),
    /FAIL frontend \/api\/events\/stream\?cursor=0&once=true next_cursor must be a finite number > 0/,
  );
});

function baseRun(overrides = {}) {
  return {
    schema: 1,
    run_id: 'seed-7',
    status: 'running',
    started_at: 100,
    timing: { duration: 1800 },
    constants: baseRunConstants(),
    ...overrides,
  };
}

function baseRunConstants() {
  return {
    home_upkeep_materials_per_second: 0.2,
    mating_cooldown_seconds: 60,
    ruins_persist_seconds: 120,
  };
}

function requiredRunConstantKeys() {
  return Object.keys(baseRunConstants());
}

function apiRun(overrides = {}) {
  return {
    ...baseRun({
      started_at: Math.floor(Date.now() / 1000) - 1,
      timing: { duration: 86400 },
    }),
    ...overrides,
  };
}

function stubRunFetch(t, body) {
  const calls = [];
  t.after(() => t.mock.restoreAll());
  t.mock.method(console, 'log', () => {});
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push({
      url: String(url),
      accept: options.headers?.Accept,
    });
    return {
      status: 200,
      headers: {
        get: () => 'application/json',
      },
      async json() {
        return body;
      },
    };
  });
  return calls;
}

function stubEventStreamFetch(t, options = {}) {
  const calls = [];
  const {
    status = 200,
    contentType = 'text/event-stream; charset=utf-8',
    text = 'data: {"schema":1,"next_cursor":1}\n\n',
  } = options;
  t.after(() => t.mock.restoreAll());
  t.mock.method(console, 'log', () => {});
  t.mock.method(globalThis, 'fetch', async (url, fetchOptions = {}) => {
    calls.push({
      url: String(url),
      accept: fetchOptions.headers?.Accept,
    });
    return {
      status,
      headers: {
        get(name) {
          return String(name).toLowerCase() === 'content-type' ? contentType : null;
        },
      },
      async text() {
        return text;
      },
    };
  });
  return calls;
}

function capturePreflightFailure(t) {
  const errors = [];
  t.after(() => t.mock.restoreAll());
  t.mock.method(console, 'error', (message) => {
    errors.push(String(message));
  });
  t.mock.method(process, 'exit', (code) => {
    const error = new Error(`process.exit(${code})`);
    error.exitCode = code;
    throw error;
  });
  return errors;
}
