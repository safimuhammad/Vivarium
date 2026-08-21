const assert = require('node:assert/strict');
const test = require('node:test');

const {
  REQUIRED_RUN_CONSTANT_KEYS,
  _test,
  buildRawRunMetadataBannedCopy,
  fetchRunMetadata,
  expectNoRawRunMetadataCopy,
  expectRunEnvelopeConstants,
} = require('./live-common-helpers');

test('run metadata helper fetches /api/run through Playwright request context', async () => {
  const calls = [];
  const envelope = await fetchRunMetadata({
    async get(path, options) {
      calls.push({ path, options });
      return {
        ok: () => true,
        status: () => 200,
        async json() {
          return runEnvelope().body;
        },
      };
    },
  });

  assert.deepEqual(calls, [
    {
      path: '/api/run',
      options: { headers: { Accept: 'application/json' } },
    },
  ]);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.status, 200);
  assert.equal(envelope.body.constants.home_upkeep_materials_per_second, 0.1);
});

test('run constants helper accepts positive finite frontend timing metadata', () => {
  const constants = expectRunEnvelopeConstants(runEnvelope());

  assert.equal(constants.home_upkeep_materials_per_second, 0.1);
  assert.deepEqual(REQUIRED_RUN_CONSTANT_KEYS, [
    'home_upkeep_materials_per_second',
    'mating_cooldown_seconds',
    'ruins_persist_seconds',
  ]);
});

test('raw run metadata copy builder covers all run constants and camelCase variants', () => {
  const bannedCopy = buildRawRunMetadataBannedCopy(runEnvelope({
    home_build_materials_cost: 4,
    paralysis_energy_threshold: 1,
    hoarding_energy_threshold: 8,
  }).body);

  assert(bannedCopy.includes('home_build_materials_cost'));
  assert(bannedCopy.includes('homeBuildMaterialsCost'));
  assert(bannedCopy.includes('paralysis_energy_threshold'));
  assert(bannedCopy.includes('paralysisEnergyThreshold'));
  assert(bannedCopy.includes('hoarding_energy_threshold'));
  assert(bannedCopy.includes('hoardingEnergyThreshold'));
  assert(bannedCopy.includes('home_upkeep_materials_per_second'));
  assert(bannedCopy.includes('homeUpkeepMaterialsPerSecond'));
  assert(bannedCopy.includes('/api/run.constants'));
  assert(bannedCopy.includes('/api/replay/artifacts'));
});

test('raw run metadata copy diagnostics are capped and redacted on failure', async () => {
  const secret = 'raw-provider-secret-/Users/example/runs/private/events.jsonl';
  const page = {
    async evaluate(fn, payload) {
      assert.equal(payload.values[0].length, secret.length);
      assert.equal(payload.values[0].normalized, secret.toLowerCase());
      assert.equal(payload.values[0].hash.length, 8);
      return Array.from({ length: payload.limit + 3 }, (_, index) => ({
        source: index === 0 ? 'body innerText' : 'title',
        valueHash: payload.values[0].hash,
        valueLength: payload.values[0].length,
        textLength: 500,
        index,
      })).slice(0, payload.limit);
    },
  };

  await assert.rejects(
    () => expectNoRawRunMetadataCopy(page, [secret]),
    (error) => {
      assert.match(error.message, /valueHash/);
      assert.doesNotMatch(error.message, /raw-provider-secret/);
      assert.doesNotMatch(error.message, /\/Users\/example/);
      assert.doesNotMatch(error.message, /events\.jsonl/);
      return true;
    },
  );
});

test('live event presentation validator accepts generic chronicle and inspector rows', () => {
  assert.deepEqual(_test.validateLiveEventPresentationState({
    diagnostics: {
      connection: 'live',
      eventCursor: 7,
      stream: { active: true, cursor: 6 },
      lastEnvelopeCursor: 7,
    },
    chronicleRows: [
      eventPresentationRow({ cursor: 7 }),
    ],
    inspectorRows: [],
  }), []);
});

test('live event presentation validator accepts fresh row from active stream window', () => {
  assert.deepEqual(_test.validateLiveEventPresentationState({
    diagnostics: liveDiagnostics({
      eventCursor: 12,
      stream: { active: true, cursor: 10 },
      lastEnvelopeCursor: 12,
    }),
    chronicleRows: [
      eventPresentationRow({ cursor: 9 }),
      eventPresentationRow({ cursor: 11 }),
    ],
  }), []);
});

test('live event presentation validator accepts arbitrary event taxonomy', () => {
  assert.deepEqual(_test.validateLiveEventPresentationState({
    diagnostics: liveDiagnostics(),
    chronicleRows: [
      eventPresentationRow({
        type: 'weather_shifted',
        group: 'ambient',
        tone: 'quiet',
        text: 'a hush crosses the shore',
      }),
    ],
  }), []);
});

test('live renderer freshness validator accepts a fresh rendered beat', () => {
  assert.deepEqual(_test.validateLiveRendererFreshnessState({
    diagnostics: liveDiagnostics({
      eventCursor: 9,
      stream: { active: true, cursor: 7 },
      lastEnvelopeCursor: 9,
    }),
    renderer: {
      hasWorldHandle: true,
      hasRecentRenderedEventBeats: true,
      appliedEventCursors: [8],
      recentRenderedEventBeats: [
        renderedBeat({ cursor: 8 }),
      ],
    },
    presentationChronicleRows: [
      eventPresentationRow({ cursor: 8 }),
    ],
    currentChronicleRows: [],
  }), []);
});

test('live renderer freshness validator rejects snapshot-only cursor bookkeeping', () => {
  assert.deepEqual(_test.validateLiveRendererFreshnessState({
    diagnostics: liveDiagnostics({
      eventCursor: 9,
      stream: { active: true, cursor: 7 },
      lastEnvelopeCursor: 9,
    }),
    renderer: {
      hasWorldHandle: true,
      hasRecentRenderedEventBeats: true,
      appliedEventCursors: [8, 9],
      recentRenderedEventBeats: [],
    },
    presentationChronicleRows: [
      eventPresentationRow({ cursor: 8 }),
    ],
  }), [
    'renderer has no recent rendered event beats',
  ]);
});

test('live renderer freshness validator rejects stale rendered beats', () => {
  assert.deepEqual(_test.validateLiveRendererFreshnessState({
    diagnostics: liveDiagnostics({
      eventCursor: 12,
      stream: { active: true, cursor: 10 },
      lastEnvelopeCursor: 12,
    }),
    renderer: {
      hasWorldHandle: true,
      hasRecentRenderedEventBeats: true,
      appliedEventCursors: [8, 10],
      recentRenderedEventBeats: [
        renderedBeat({ cursor: 8 }),
        renderedBeat({ cursor: 10 }),
      ],
    },
    presentationChronicleRows: [
      eventPresentationRow({ cursor: 11 }),
    ],
  }), [
    'renderer rendered beat entries are not fresh live effects',
  ]);
});

test('live renderer freshness validator requires active stream envelope diagnostics', () => {
  assert.deepEqual(_test.validateLiveRendererFreshnessState({
    diagnostics: liveDiagnostics({
      eventCursor: 9,
      stream: { active: false, cursor: 7 },
      lastEnvelopeCursor: null,
    }),
    renderer: {
      hasWorldHandle: true,
      hasRecentRenderedEventBeats: true,
      appliedEventCursors: [8],
      recentRenderedEventBeats: [
        renderedBeat({ cursor: 8 }),
      ],
    },
    presentationChronicleRows: [
      eventPresentationRow({ cursor: 8 }),
    ],
  }), [
    'live event stream is inactive',
    'live diagnostics are missing a positive last envelope cursor',
  ]);
});

test('live retained presentation validator accepts provider-agnostic retained surfaces', () => {
  assert.deepEqual(
    _test.validateLiveRetainedSurfacePresentationState(retainedPresentationState()),
    [],
  );
});

test('live retained presentation validator rejects stale retained pulse cursors', () => {
  assert.deepEqual(
    _test.validateLiveRetainedSurfacePresentationState(retainedPresentationState({
      api: { ok: true, status: 200, eventCursors: [9, 11] },
      chronicleRows: [
        retainedEventRow({ cursor: 9 }),
        retainedEventRow({ cursor: 11 }),
      ],
      renderer: {
        hasWorldHandle: true,
        livePixels: 48,
        renderedEventCursors: [9, 11],
        recentRenderedEventBeats: [],
      },
      livePulse: retainedSurface({ cursor: 9 }),
    })),
    ['World pulse should retain a fresh live event cursor'],
  );
});

test('live retained presentation validator rejects transient-only bubble proof', () => {
  assert.deepEqual(
    _test.validateLiveRetainedSurfacePresentationState(retainedPresentationState({
      transient: {
        activeBubbleCursors: [11],
        activeBubbleEffectCursors: [11],
      },
    })),
    [
      'World pulse retained event should no longer have active bubble UI',
      'Now cue surface retained event should no longer have active bubble UI',
    ],
  );
});

test('live retained presentation validator rejects missing API and renderer evidence', () => {
  assert.deepEqual(
    _test.validateLiveRetainedSurfacePresentationState(retainedPresentationState({
      api: { ok: false, status: 500, eventCursors: [] },
      renderer: {
        hasWorldHandle: false,
        livePixels: 0,
        renderedEventCursors: [],
        recentRenderedEventBeats: [],
      },
    })),
    [
      'external live retained proof should fetch API event cursors',
      'renderer debug handle should be available',
      'renderer debug handle should expose retained event cursor memory',
      'renderer should expose visible live world pixels',
      'World pulse retained cursor should match API and renderer evidence',
      'Now cue surface retained cursor should match API and renderer evidence',
    ],
  );
});

test('live retained presentation validator rejects controls raw copy and missing now retention', () => {
  assert.deepEqual(
    _test.validateLiveRetainedSurfacePresentationState(retainedPresentationState({
      liveNow: {
        ...retainedNowSurface({ cursor: 11 }),
        state: 'quiet',
      },
      controls: {
        chronicle: 1,
        livePulse: 0,
        liveNow: 1,
        seekCopy: true,
      },
      retainedCopyLeaks: ['agent_001 raw label'],
    })),
    [
      'Now cue surface should expose retained state',
      'chronicle should not introduce controls or dialogs',
      'liveNow should not introduce controls or dialogs',
      'retained external smoke should not expose seek/scrub/playback copy',
      'retained live surface attributes should not expose backend/raw vocabulary',
    ],
  );
});

test('live retained presentation diagnostics are bounded and redact raw provider detail', () => {
  const message = _test.formatLiveRetainedSurfacePresentationFailure(
    ['World pulse retained cursor should match API and renderer evidence'],
    retainedPresentationState({
      diagnostics: {
        ...liveDiagnostics({
          eventCursor: 12,
          stream: {
            active: true,
            cursor: 10,
            url: '/api/events/stream?cursor=10',
          },
          lastEnvelopeCursor: 12,
        }),
        provider: 'raw-provider-name',
        model: 'raw-model-name',
        run_id: 'raw-run-id',
      },
      chronicleRows: [
        retainedEventRow({
          cursor: 11,
          type: 'raw_event_type',
          group: 'raw_event_group',
          tone: 'raw_event_tone',
          textLength: 87,
          text: 'raw provider prose /Users/example/runs/private/events.jsonl',
        }),
      ],
      retainedCopyLeaks: [
        'raw-provider-name',
        '/Users/example/runs/private/events.jsonl',
      ],
    }),
  );

  assert.match(message, /Retained copy leaks: many/);
  assert.match(message, /World pulse:/);
  assert.doesNotMatch(message, /raw-provider-name/);
  assert.doesNotMatch(message, /raw-model-name/);
  assert.doesNotMatch(message, /raw-run-id/);
  assert.doesNotMatch(message, /events\/stream/);
  assert.doesNotMatch(message, /\/Users\/example/);
  assert.doesNotMatch(message, /raw_event_type/);
  assert.doesNotMatch(message, /raw provider prose/);
});

test('live renderer freshness diagnostics are bounded and redact raw provider detail', () => {
  const message = _test.formatLiveRendererFreshnessFailure(
    ['renderer rendered beat entries are not fresh live effects'],
    {
      diagnostics: {
        ...liveDiagnostics({
          eventCursor: 12,
          stream: {
            active: true,
            cursor: 10,
            url: '/api/events/stream?cursor=10',
          },
          lastEnvelopeCursor: 12,
        }),
        provider: 'raw-provider-name',
        model: 'raw-model-name',
        run_id: 'raw-run-id',
      },
      renderer: {
        hasWorldHandle: true,
        hasRecentRenderedEventBeats: true,
        appliedEventCursors: [8, 10],
        recentRenderedEventBeats: Array.from({ length: 7 }, (_, index) => (
          renderedBeat({
            cursor: index + 3,
            eventType: `raw_provider_event_type_${index}`,
            group: 'raw_provider_group',
            summaryKinds: [
              `private summary ${index}`,
              '/Users/example/runs/private/events.jsonl',
            ],
          })
        )),
      },
      presentationChronicleRows: [
        eventPresentationRow({
          cursor: 11,
          type: 'raw_chronicle_type',
          group: 'raw_chronicle_group',
          text: 'raw provider prose /Users/example/runs/private/events.jsonl',
        }),
      ],
    },
  );

  assert.match(message, /staleBeats=many/);
  assert.match(message, /Rendered beat samples:/);
  assert.doesNotMatch(message, /"index":5/);
  assert.doesNotMatch(message, /raw-provider-name/);
  assert.doesNotMatch(message, /raw-model-name/);
  assert.doesNotMatch(message, /raw-run-id/);
  assert.doesNotMatch(message, /events\/stream/);
  assert.doesNotMatch(message, /\/Users\/example/);
  assert.doesNotMatch(message, /raw_provider_event_type/);
  assert.doesNotMatch(message, /raw_provider_group/);
  assert.doesNotMatch(message, /private summary/);
  assert.doesNotMatch(message, /raw provider prose/);
});

test('live event presentation validator requires matching durable observer rows', () => {
  assert.deepEqual(_test.validateLiveEventPresentationState({
    diagnostics: {
      connection: 'live',
      eventCursor: 7,
      stream: { active: true, cursor: 6 },
      lastEnvelopeCursor: 7,
    },
    chronicleRows: [
      eventPresentationRow({ cursor: 9 }),
    ],
    inspectorRows: [],
  }), [
    'chronicle event row cursors do not match live cursor progress',
    'chronicle has no fresh live stream rows',
  ]);
});

test('live event presentation validator rejects stale-only stream rows', () => {
  assert.deepEqual(_test.validateLiveEventPresentationState({
    diagnostics: liveDiagnostics({
      eventCursor: 12,
      stream: { active: true, cursor: 10 },
      lastEnvelopeCursor: 12,
    }),
    chronicleRows: [
      eventPresentationRow({ cursor: 8 }),
      eventPresentationRow({ cursor: 10 }),
    ],
  }), [
    'chronicle has no fresh live stream rows',
  ]);
});

test('live event presentation validator classifies no post-stream cursor progress', () => {
  assert.deepEqual(_test.validateLiveEventPresentationState({
    diagnostics: liveDiagnostics({
      eventCursor: 1,
      stream: { active: true, cursor: 1 },
      lastEnvelopeCursor: 1,
    }),
    chronicleRows: [
      eventPresentationRow({ cursor: 1 }),
    ],
  }), [
    'live event cursor did not advance beyond the active stream cursor',
  ]);
});

test('live event presentation validator classifies no post-stream cursor progress without rows', () => {
  assert.deepEqual(_test.validateLiveEventPresentationState({
    diagnostics: liveDiagnostics({
      eventCursor: 1,
      stream: { active: true, cursor: 1 },
      lastEnvelopeCursor: null,
    }),
    chronicleRows: [],
  }), [
    'live diagnostics are missing a positive last envelope cursor',
    'live event cursor did not advance beyond the active stream cursor',
    'chronicle has no live event rows',
  ]);
});

test('live event presentation validator requires active stream envelope diagnostics', () => {
  assert.deepEqual(_test.validateLiveEventPresentationState({
    diagnostics: {
      connection: 'live',
      eventCursor: 7,
      stream: { active: false },
      lastEnvelopeCursor: null,
    },
    chronicleRows: [
      eventPresentationRow({ cursor: 7 }),
    ],
  }), [
    'live event stream is inactive',
    'live diagnostics are missing a positive last envelope cursor',
    'live diagnostics are missing an active stream cursor',
  ]);
});

test('live event presentation validator reports missing active stream cursor', () => {
  assert.deepEqual(_test.validateLiveEventPresentationState({
    diagnostics: {
      connection: 'live',
      eventCursor: 7,
      stream: { active: true },
      lastEnvelopeCursor: 7,
    },
    chronicleRows: [
      eventPresentationRow({ cursor: 7 }),
    ],
  }), [
    'live diagnostics are missing an active stream cursor',
  ]);
});

test('live event presentation validator accepts last opened stream cursor fallback', () => {
  assert.deepEqual(_test.validateLiveEventPresentationState({
    diagnostics: {
      connection: 'live',
      eventCursor: 7,
      stream: { active: true },
      lastOpenedStreamCursor: 6,
      lastEnvelopeCursor: 7,
    },
    chronicleRows: [
      eventPresentationRow({ cursor: 7 }),
    ],
  }), []);
});

test('live event presentation validator reports unavailable diagnostics', () => {
  assert.deepEqual(_test.validateLiveEventPresentationState({
    diagnostics: null,
    chronicleRows: [],
  }), [
    'live diagnostics should be available',
    'live diagnostics are missing a positive event cursor',
    'live event stream is inactive',
    'live diagnostics are missing a positive last envelope cursor',
    'live diagnostics are missing an active stream cursor',
    'chronicle has no live event rows',
  ]);
});

test('live event presentation validator distinguishes missing live cursors', () => {
  assert.deepEqual(_test.validateLiveEventPresentationState({
    diagnostics: {
      connection: 'live',
      eventCursor: 0,
      stream: { active: true },
      lastEnvelopeCursor: null,
    },
    chronicleRows: [
      eventPresentationRow({ cursor: 1 }),
    ],
  }), [
    'live diagnostics are missing a positive event cursor',
    'live diagnostics are missing a positive last envelope cursor',
    'live diagnostics are missing an active stream cursor',
  ]);
});

test('live event presentation validator distinguishes missing chronicle rows', () => {
  assert.deepEqual(_test.validateLiveEventPresentationState({
    diagnostics: liveDiagnostics(),
    chronicleRows: [],
  }), [
    'chronicle has no live event rows',
  ]);
});

test('live event presentation validator distinguishes invisible chronicle rows', () => {
  assert.deepEqual(_test.validateLiveEventPresentationState({
    diagnostics: liveDiagnostics(),
    chronicleRows: [
      eventPresentationRow({ visible: false }),
    ],
  }), [
    'chronicle event rows are not visible',
  ]);
});

test('live event presentation validator distinguishes malformed chronicle rows', () => {
  assert.deepEqual(_test.validateLiveEventPresentationState({
    diagnostics: liveDiagnostics(),
    chronicleRows: [
      eventPresentationRow({ type: '' }),
    ],
  }), [
    'chronicle event rows are malformed',
  ]);
});

test('live event presentation diagnostics use bounded sanitized snapshots', () => {
  const snapshot = _test.sanitizeLiveEventPresentationState({
    diagnostics: liveDiagnostics({ lastAcceptedSnapshotCursor: 3 }),
    chronicleRows: Array.from({ length: 6 }, (_, index) => (
      eventPresentationRow({ cursor: index + 1 })
    )),
    inspectorRows: [
      eventPresentationRow(),
    ],
    eventBubbleCount: 2,
    activeEventEffectCount: 1,
  });

  assert.equal(snapshot.chronicleRowCount, 6);
  assert.deepEqual(snapshot.chronicle, {
    rowCount: 6,
    visibleRows: 6,
    matchingRows: 1,
    hiddenRows: 0,
    malformedRows: 0,
    futureCursorRows: 0,
    staleRows: 5,
    freshThreshold: 5,
    freshRows: 1,
    freshCursorRange: { min: 6, max: 6 },
    cursorRange: { min: 1, max: 6 },
  });
  assert.equal(snapshot.chronicleRows.length, 5);
  assert.equal(snapshot.omittedChronicleRowCount, 1);
  assert.equal(snapshot.inspectorRowCount, 1);
  assert.equal(snapshot.eventBubbleCount, 2);
  assert.equal(snapshot.activeEventEffectCount, 1);
  assert.equal(Object.hasOwn(snapshot.chronicleRows[0], 'type'), false);
  assert.equal(Object.hasOwn(snapshot.chronicleRows[0], 'text'), false);
  assert.deepEqual(snapshot.chronicleRows[0], {
    index: 0,
    cursor: 1,
    visible: true,
    hasType: true,
    hasGroup: true,
    hasTone: true,
    textLength: 12,
    problems: ['not-fresh-for-active-stream'],
  });
});

test('live event presentation diagnostics summarize cursor mismatch', () => {
  const message = _test.formatLiveEventPresentationFailure(
    ['chronicle event row cursors do not match live cursor progress'],
    {
      diagnostics: liveDiagnostics({ eventCursor: 7 }),
      chronicleRows: [
        eventPresentationRow({ cursor: 9 }),
      ],
    },
  );

  assert.match(message, /eventCursor=7/);
  assert.match(message, /rows=1/);
  assert.match(message, /matchingRows=0/);
  assert.match(message, /futureCursorRows=1/);
  assert.match(message, /freshThreshold=5/);
  assert.match(message, /freshRows=0/);
  assert.match(message, /cursor-ahead-of-live-progress/);
});

test('live event presentation diagnostics summarize stale freshness without raw copy', () => {
  const message = _test.formatLiveEventPresentationFailure(
    ['chronicle has no fresh live stream rows'],
    {
      diagnostics: {
        ...liveDiagnostics({
          eventCursor: 12,
          stream: { active: true, cursor: 10 },
          lastEnvelopeCursor: 12,
        }),
        provider: 'raw-provider-name',
        model: 'raw-model-name',
        run_id: 'raw-run-id',
      },
      chronicleRows: Array.from({ length: 7 }, (_, index) => (
        eventPresentationRow({
          cursor: index + 4,
          text: `private event prose ${index} /Users/example/runs/private/events.jsonl`,
          artifact: '/Users/example/runs/private/events.jsonl',
        })
      )),
    },
  );

  assert.match(message, /freshThreshold=10/);
  assert.match(message, /freshRows=0/);
  assert.match(message, /freshCursorRange=none/);
  assert.match(message, /staleRows=7/);
  assert.doesNotMatch(message, /"index":5/);
  assert.doesNotMatch(message, /raw-provider-name/);
  assert.doesNotMatch(message, /raw-model-name/);
  assert.doesNotMatch(message, /raw-run-id/);
  assert.doesNotMatch(message, /\/Users\/example/);
  assert.doesNotMatch(message, /private event prose/);
});

test('live event presentation diagnostics summarize row-shape failures', () => {
  const message = _test.formatLiveEventPresentationFailure(
    ['chronicle event rows are malformed'],
    {
      diagnostics: liveDiagnostics(),
      chronicleRows: [
        eventPresentationRow({ visible: false }),
        eventPresentationRow({ cursor: Number.NaN }),
        eventPresentationRow({ group: '' }),
        eventPresentationRow({ tone: '' }),
        eventPresentationRow({ text: '' }),
      ],
    },
  );

  assert.match(message, /hiddenRows=1/);
  assert.match(message, /malformedRows=4/);
  assert.match(message, /missing-positive-cursor/);
  assert.match(message, /missing-group/);
  assert.match(message, /missing-tone/);
  assert.match(message, /missing-text/);
});

test('live event presentation failure formatter includes generic failure summary', () => {
  const message = _test.formatLiveEventPresentationFailure([
    'chronicle event rows are malformed',
  ], {
    diagnostics: liveDiagnostics(),
    chronicleRows: [
      eventPresentationRow({ group: '' }),
    ],
  });

  assert.match(message, /chronicle event rows are malformed/);
  assert.match(message, /"hasGroup":false/);
  assert.doesNotMatch(message, /"group":/);
  assert.doesNotMatch(message, /"text":/);
});

test('live event presentation failure formatter omits raw/private fields', () => {
  const message = _test.formatLiveEventPresentationFailure(
    ['chronicle event rows are malformed'],
    {
      diagnostics: {
        ...liveDiagnostics(),
        provider: 'raw-provider-name',
        model: 'raw-model-name',
        run_id: 'raw-run-id',
        stream: {
          active: true,
          cursor: 7,
          url: '/api/events/stream?cursor=7',
        },
      },
      chronicleRows: [
        eventPresentationRow({
          cursor: 9,
          type: 'raw_event_type',
          group: 'raw_event_group',
          tone: 'raw_event_tone',
          text: 'raw provider prose /Users/example/runs/private/events.jsonl',
          artifact: '/Users/example/runs/private/events.jsonl',
        }),
      ],
      rawPath: '/Users/example/runs/private/events.jsonl',
      provider: 'raw-provider-name',
      model: 'raw-model-name',
    },
  );

  assert.doesNotMatch(message, /raw-provider-name/);
  assert.doesNotMatch(message, /raw-model-name/);
  assert.doesNotMatch(message, /raw-run-id/);
  assert.doesNotMatch(message, /events\/stream/);
  assert.doesNotMatch(message, /\/Users\/example/);
  assert.doesNotMatch(message, /raw_event_type/);
  assert.doesNotMatch(message, /raw provider prose/);
});

test('live event cursor correlation formatter is numeric and bounded', () => {
  const message = _test.formatLiveEventCursorCorrelationFailure({
    apiEventCursors: [1, 2, 3, 4, 5, 6, 7, 8, 9, '/Users/example/runs/private/events.jsonl'],
    presentedChronicleCursors: [12, 13, 'raw-provider-name'],
  });

  assert.match(message, /API cursors: count=9 range=1\.\.9 sample=1,2,3,4,5,6,7,8 omitted=1/);
  assert.match(message, /Presented chronicle cursors: count=2 range=12\.\.13 sample=12,13 omitted=0/);
  assert.doesNotMatch(message, /\/Users\/example/);
  assert.doesNotMatch(message, /raw-provider-name/);
});

test('live event presentation validator requires live connection diagnostics', () => {
  assert.deepEqual(_test.validateLiveEventPresentationState({
    diagnostics: {
      connection: 'error',
      eventCursor: 7,
      stream: { active: true, cursor: 6 },
      lastEnvelopeCursor: 7,
    },
    chronicleRows: [
      eventPresentationRow({ cursor: 7 }),
    ],
  }), [
    'live diagnostics should report a live connection',
  ]);
});

test('run constants helper requires home upkeep metadata to be present and finite', () => {
  assert.throws(
    () => expectRunEnvelopeConstants(runEnvelope({
      home_upkeep_materials_per_second: undefined,
    })),
    /\/api\/run\.constants\.home_upkeep_materials_per_second should be a finite number/,
  );

  assert.throws(
    () => expectRunEnvelopeConstants(runEnvelope({
      home_upkeep_materials_per_second: Number.POSITIVE_INFINITY,
    })),
    /\/api\/run\.constants\.home_upkeep_materials_per_second should be a finite number/,
  );
});

test('run constants helper requires positive timing constants', () => {
  assert.throws(
    () => expectRunEnvelopeConstants(runEnvelope({
      home_upkeep_materials_per_second: 0,
    })),
    /\/api\/run\.constants\.home_upkeep_materials_per_second should be positive/,
  );

  assert.throws(
    () => expectRunEnvelopeConstants(runEnvelope({
      mating_cooldown_seconds: -1,
    })),
    /\/api\/run\.constants\.mating_cooldown_seconds should be positive/,
  );
});

test('run constants helper requires constants metadata object', () => {
  assert.throws(
    () => expectRunEnvelopeConstants({
      ok: true,
      status: 200,
      body: {
        schema: 1,
        constants: null,
      },
    }),
    /\/api\/run constants metadata should be an object/,
  );
});

function runEnvelope(constantOverrides = {}) {
  return {
    ok: true,
    status: 200,
    body: {
      schema: 1,
      constants: {
        home_upkeep_materials_per_second: 0.1,
        mating_cooldown_seconds: 300,
        ruins_persist_seconds: 120,
        ...constantOverrides,
      },
    },
  };
}

function eventPresentationRow(overrides = {}) {
  return {
    cursor: 7,
    type: 'event_type',
    group: 'event_group',
    tone: 'event_tone',
    text: 'event detail',
    visible: true,
    ...overrides,
  };
}

function renderedBeat(overrides = {}) {
  return {
    cursor: 7,
    eventType: 'event_type',
    group: 'event_group',
    summaryKinds: ['generic-pulse'],
    hasBubble: false,
    hasPulse: true,
    hasArc: false,
    hasSpecial: false,
    effectCountDelta: 1,
    summaryCount: 1,
    ...overrides,
  };
}

function retainedPresentationState(overrides = {}) {
  return {
    diagnostics: liveDiagnostics({
      eventCursor: 12,
      stream: { active: true, cursor: 10 },
      lastEnvelopeCursor: 12,
    }),
    api: {
      ok: true,
      status: 200,
      eventCursors: [11],
    },
    chronicleRows: [
      retainedEventRow({ cursor: 11 }),
    ],
    renderer: {
      hasWorldHandle: true,
      livePixels: 48,
      renderedEventCursors: [11],
      recentRenderedEventBeats: [],
    },
    transient: {
      activeBubbleCursors: [],
      activeBubbleEffectCursors: [],
    },
    livePulse: retainedSurface({ cursor: 11 }),
    liveNow: retainedNowSurface({ cursor: 11 }),
    controls: {
      chronicle: 0,
      livePulse: 0,
      liveNow: 0,
      seekCopy: false,
    },
    retainedCopyLeaks: [],
    ...overrides,
  };
}

function retainedEventRow(overrides = {}) {
  return {
    cursor: 11,
    type: 'event_type',
    group: 'event_group',
    tone: 'event_tone',
    visible: true,
    textLength: 24,
    ...overrides,
  };
}

function retainedSurface(overrides = {}) {
  const cursor = overrides.cursor ?? 11;
  const type = overrides.type ?? 'event_type';
  return {
    state: 'retained',
    cursor,
    type,
    visible: true,
    latestVisible: true,
    latestCursor: cursor,
    latestType: type,
    ...overrides,
  };
}

function retainedNowSurface(overrides = {}) {
  const cursor = overrides.cursor ?? 11;
  const type = overrides.type ?? 'event_type';
  return {
    state: 'retained',
    cursor,
    type,
    visible: true,
    cues: [{ cursor, type, visible: true }],
    ...overrides,
  };
}

function liveDiagnostics(overrides = {}) {
  const stream = {
    active: true,
    cursor: 5,
    ...(overrides.stream || {}),
  };

  return {
    connection: 'live',
    eventCursor: 7,
    stream,
    lastEnvelopeCursor: 7,
    lastOpenedStreamCursor: 5,
    ...overrides,
    stream,
  };
}
