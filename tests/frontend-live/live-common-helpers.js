const { expect } = require('@playwright/test');

const REQUIRED_RUN_CONSTANT_KEYS = Object.freeze([
  'home_upkeep_materials_per_second',
  'mating_cooldown_seconds',
  'ruins_persist_seconds',
]);
const RAW_RUN_METADATA_COPY_LABELS = Object.freeze([
  ...REQUIRED_RUN_CONSTANT_KEYS,
  ...REQUIRED_RUN_CONSTANT_KEYS.map(camelCaseConstantKey),
  '/api/run.constants',
  'run.constants',
  'runs/',
  '/api/replay/artifacts',
]);
const RAW_RUN_METADATA_LEAK_LIMIT = 10;

async function fetchRunMetadata(request) {
  const response = await request.get('/api/run', {
    headers: { Accept: 'application/json' },
  });
  return {
    ok: response.ok(),
    status: response.status(),
    body: await response.json(),
  };
}

async function fetchWorldSnapshot(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/world', {
      headers: { Accept: 'application/json' },
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json(),
    };
  });
}

async function fetchJsonlArtifact(page, path) {
  return page.evaluate(async (artifactPath) => {
    const response = await fetch(artifactPath, {
      headers: { Accept: 'application/x-ndjson' },
    });
    const text = await response.text();
    const rows = text.trim()
      ? text.trim().split(/\n+/).map((line, index) => ({
        cursor: index + 1,
        ...JSON.parse(line),
      }))
      : [];
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      rows,
    };
  }, path);
}

function byField(items, field, value) {
  return items.find((item) => item[field] === value);
}

function expectRunEnvelopeConstants(envelope, requiredKeys = REQUIRED_RUN_CONSTANT_KEYS) {
  expect(envelope.ok).toBe(true);
  expect(envelope.status).toBe(200);
  expect(envelope.body.schema).toBe(1);

  const constants = envelope.body.constants;
  expect(
    isPlainObject(constants),
    '/api/run constants metadata should be an object',
  ).toBe(true);

  for (const key of requiredKeys) {
    const value = constants[key];
    expect(
      Number.isFinite(value),
      `/api/run.constants.${key} should be a finite number`,
    ).toBe(true);
    expect(
      value,
      `/api/run.constants.${key} should be positive`,
    ).toBeGreaterThan(0);
  }

  return constants;
}

function buildRawRunMetadataBannedCopy(runMetadata) {
  const artifacts = isPlainObject(runMetadata?.artifacts)
    ? Object.values(runMetadata.artifacts)
    : [];
  const constantKeys = isPlainObject(runMetadata?.constants)
    ? Object.keys(runMetadata.constants)
    : [];

  return [
    runMetadata?.run_id,
    runMetadata?.config_hash,
    runMetadata?.provider,
    runMetadata?.model,
    ...artifacts,
    ...constantKeys,
    ...constantKeys.map(camelCaseConstantKey),
    ...RAW_RUN_METADATA_COPY_LABELS,
  ];
}

async function expectRunConstants(request, requiredKeys = REQUIRED_RUN_CONSTANT_KEYS) {
  const envelope = await fetchRunMetadata(request);
  expectRunEnvelopeConstants(envelope, requiredKeys);
  return envelope;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function camelCaseConstantKey(key) {
  return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

const bannedBackendVocabularyPattern = '(^|[^a-z0-9])(simulations?|agents?|llms?|spawn|spawns|spawned|spawning|npcs?)(?=$|[^a-z0-9])';

async function expectNoBannedObserverCopy(page) {
  const leaks = await page.evaluate((pattern) => {
    const banned = new RegExp(pattern, 'i');
    const root = document.body;
    const leaks = [];

    const check = (source, value) => {
      const normalized = (value || '').replace(/\s+/g, ' ').trim();
      const match = normalized.match(banned);
      if (!match) {
        return;
      }
      const index = match.index || 0;
      leaks.push(`${source}: ${normalized.slice(Math.max(0, index - 48), index + 96)}`);
    };

    check('body innerText', root.innerText);

    for (const node of Array.from(root.querySelectorAll('[title], [aria-label]'))) {
      check('title', node.getAttribute('title'));
      check('aria-label', node.getAttribute('aria-label'));
    }

    return leaks;
  }, bannedBackendVocabularyPattern);

  expect(leaks).toEqual([]);
}

async function expectNoLiveDiagnosticCopy(page) {
  const leaks = await page.evaluate(() => {
    const pattern = /(__vivariumLiveRun|activeStream|streamSerial|recoveryRetry|refreshInFlight|lastAcceptedSnapshot|lastRejectedSnapshot|lastRejectedSnapshotReason|ignoredStaleStream|events\/stream\?cursor)/i;
    const root = document.body;
    const leaks = [];
    const check = (source, value) => {
      const normalized = (value || '').replace(/\s+/g, ' ').trim();
      const match = normalized.match(pattern);
      if (!match) {
        return;
      }
      const index = match.index || 0;
      leaks.push(`${source}: ${normalized.slice(Math.max(0, index - 32), index + 96)}`);
    };
    check('body innerText', root.innerText);
    for (const node of Array.from(root.querySelectorAll('[title], [aria-label]'))) {
      check('title', node.getAttribute('title'));
      check('aria-label', node.getAttribute('aria-label'));
    }
    return leaks;
  });

  expect(leaks).toEqual([]);
}

async function expectNoRawRunMetadataCopy(page, bannedValues) {
  const needles = buildRawRunMetadataNeedles(bannedValues);

  expect(
    needles.length,
    'raw run metadata copy guard should receive at least one banned value',
  ).toBeGreaterThan(0);

  const leaks = await page.evaluate(({ values, limit }) => {
    const root = document.body;
    const leaks = [];

    const check = (source, value) => {
      if (leaks.length >= limit) return;

      const normalized = (value || '').replace(/\s+/g, ' ').trim();
      const lower = normalized.toLowerCase();

      for (const needle of values) {
        const index = lower.indexOf(needle.normalized);
        if (index === -1) {
          continue;
        }

        leaks.push({
          source,
          valueHash: needle.hash,
          valueLength: needle.length,
          textLength: normalized.length,
          index,
        });
        if (leaks.length >= limit) return;
      }
    };

    // Observer-facing copy only: data-* attributes and QA/debug globals are not product copy.
    check('body innerText', root.innerText);

    for (const node of Array.from(root.querySelectorAll('[title], [aria-label]'))) {
      check('title', node.getAttribute('title'));
      check('aria-label', node.getAttribute('aria-label'));
    }

    return leaks;
  }, { values: needles, limit: RAW_RUN_METADATA_LEAK_LIMIT });

  expect(leaks).toEqual([]);
}

function buildRawRunMetadataNeedles(bannedValues) {
  return Array.from(new Set(
    bannedValues
      .map((value) => String(value ?? '').trim())
      .filter((value) => value.length > 0),
  )).map((value) => ({
    normalized: value.toLowerCase(),
    hash: hashDiagnosticValue(value),
    length: value.length,
  }));
}

function hashDiagnosticValue(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function expectLiveEventPresentation(page, options = {}) {
  const timeout = positiveTimeout(options.timeout, 15000);

  try {
    await page.waitForFunction(() => {
      const diagnostics = window.__vivariumLiveRun?.diagnostics?.();
      if (
        !diagnostics ||
        diagnostics.connection !== 'live' ||
        diagnostics.stream?.active !== true ||
        diagnostics.eventCursor <= 0 ||
        diagnostics.lastEnvelopeCursor === null
      ) {
        return false;
      }

      const freshThreshold = liveFreshnessThreshold(diagnostics);
      if (!Number.isFinite(freshThreshold) || freshThreshold < 0) {
        return false;
      }

      return Array.from(document.querySelectorAll('.chronicle [data-event-kind="event"]'))
        .some((row) => {
          const cursor = Number(row.getAttribute('data-event-cursor'));
          const rect = row.getBoundingClientRect();
          const style = getComputedStyle(row);
          const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
          return (
            Number.isFinite(cursor) &&
            cursor > freshThreshold &&
            cursor <= diagnostics.eventCursor &&
            row.getAttribute('data-event-type') &&
            row.getAttribute('data-event-group') &&
            row.getAttribute('data-event-tone') &&
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            text.length > 0
          );
        });

      function liveFreshnessThreshold(diagnostics) {
        const streamCursor = Number(diagnostics?.stream?.cursor);
        if (Number.isFinite(streamCursor) && streamCursor >= 0) {
          return streamCursor;
        }

        const openedCursor = Number(diagnostics?.lastOpenedStreamCursor);
        if (Number.isFinite(openedCursor) && openedCursor >= 0) {
          return openedCursor;
        }

        return null;
      }
    }, null, { timeout });
  } catch {
    // The assertion below emits a categorized, bounded snapshot of the current page state.
  }

  const state = await collectLiveEventPresentationState(page);
  assertLiveEventPresentationState(state);
  return state;
}

async function expectLiveRendererFreshness(page, presentationState, options = {}) {
  const timeout = positiveTimeout(options.timeout, 15000);

  try {
    await page.waitForFunction(() => {
      const diagnostics = window.__vivariumLiveRun?.diagnostics?.();
      const beats = window.__vivariumWorld?.recentRenderedEventBeats?.();
      if (!diagnostics || !Array.isArray(beats)) {
        return false;
      }

      const eventCursor = Number(diagnostics.eventCursor);
      const lastEnvelopeCursor = Number(diagnostics.lastEnvelopeCursor);
      const freshThreshold = liveFreshnessThreshold(diagnostics);
      return (
        diagnostics.stream?.active === true &&
        Number.isFinite(eventCursor) &&
        eventCursor > 0 &&
        Number.isFinite(lastEnvelopeCursor) &&
        lastEnvelopeCursor > 0 &&
        Number.isFinite(freshThreshold) &&
        freshThreshold >= 0 &&
        beats.some((beat) => {
          const cursor = Number(beat?.cursor);
          const effectCountDelta = Number(beat?.effectCountDelta);
          return (
            Number.isFinite(cursor) &&
            cursor > freshThreshold &&
            cursor <= eventCursor &&
            Number.isFinite(effectCountDelta) &&
            effectCountDelta > 0
          );
        })
      );

      function liveFreshnessThreshold(diagnostics) {
        const streamCursor = Number(diagnostics?.stream?.cursor);
        if (Number.isFinite(streamCursor) && streamCursor >= 0) {
          return streamCursor;
        }

        const openedCursor = Number(diagnostics?.lastOpenedStreamCursor);
        if (Number.isFinite(openedCursor) && openedCursor >= 0) {
          return openedCursor;
        }

        return null;
      }
    }, null, { timeout });
  } catch {
    // The assertion below emits a categorized, bounded snapshot of the current page state.
  }

  const state = await collectLiveRendererFreshnessState(page, presentationState);
  assertLiveRendererFreshnessState(state);
  return state;
}

async function expectLiveRetainedSurfacePresentation(page, options = {}) {
  const timeout = positiveTimeout(options.timeout, 15000);
  const state = await waitForLiveRetainedSurfacePresentationState(page, timeout);
  assertLiveRetainedSurfacePresentationState(state);
  return state;
}

async function waitForLiveRetainedSurfacePresentationState(page, timeout) {
  const startedAt = Date.now();
  const pollMs = 150;
  let lastState = null;

  while (Date.now() - startedAt <= timeout) {
    lastState = await collectLiveRetainedSurfacePresentationState(page);
    if (validateLiveRetainedSurfacePresentationState(lastState).length === 0) {
      return lastState;
    }

    const remainingMs = timeout - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      break;
    }
    await page.waitForTimeout(Math.min(pollMs, remainingMs));
  }

  // The assertion below emits a categorized, bounded snapshot of the current page state.
  return lastState ?? collectLiveRetainedSurfacePresentationState(page);
}

async function collectLiveEventPresentationState(page) {
  return page.evaluate(() => {
    const eventRows = (selector) => Array.from(document.querySelectorAll(selector))
      .map((row) => {
        const rect = row.getBoundingClientRect();
        const style = getComputedStyle(row);
        return {
          cursor: Number(row.getAttribute('data-event-cursor')),
          type: row.getAttribute('data-event-type') || '',
          group: row.getAttribute('data-event-group') || '',
          tone: row.getAttribute('data-event-tone') || '',
          text: (row.textContent || '').replace(/\s+/g, ' ').trim(),
          visible: (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          ),
        };
      });
    const bubbles = Array.from(document.querySelectorAll('.viv-event-bubble'))
      .filter((bubble) => bubble.getAttribute('data-event-type') && bubble.getAttribute('data-event-group'));
    const activeEffects = window.__vivariumWorld?.activeEffects?.() || [];
    const diagnostics = window.__vivariumLiveRun?.diagnostics?.() || null;

    return {
      diagnostics: diagnostics
        ? {
            connection: diagnostics.connection,
            eventCursor: diagnostics.eventCursor,
            stream: {
              active: diagnostics.stream?.active === true,
              cursor: diagnostics.stream?.cursor,
            },
            lastOpenedStreamCursor: diagnostics.lastOpenedStreamCursor,
            lastEnvelopeCursor: diagnostics.lastEnvelopeCursor,
            lastAcceptedSnapshotCursor: diagnostics.lastAcceptedSnapshotCursor,
          }
        : null,
      chronicleRows: eventRows('.chronicle [data-event-kind="event"]'),
      inspectorRows: eventRows('.inspector-recent [data-event-kind="event"]'),
      eventBubbleCount: bubbles.length,
      activeEventEffectCount: activeEffects.filter((effect) => effect.eventType).length,
    };
  });
}

async function collectLiveRendererFreshnessState(page, presentationState) {
  return page.evaluate((capturedPresentationState) => {
    const currentChronicleRows = Array.from(document.querySelectorAll('.chronicle [data-event-kind="event"]'))
      .map((row) => {
        const rect = row.getBoundingClientRect();
        const style = getComputedStyle(row);
        return {
          cursor: Number(row.getAttribute('data-event-cursor')),
          type: row.getAttribute('data-event-type') || '',
          group: row.getAttribute('data-event-group') || '',
          tone: row.getAttribute('data-event-tone') || '',
          text: (row.textContent || '').replace(/\s+/g, ' ').trim(),
          visible: (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          ),
        };
      });
    const diagnostics = window.__vivariumLiveRun?.diagnostics?.() || null;
    const world = window.__vivariumWorld || null;
    const recentRenderedEventBeats = world?.recentRenderedEventBeats?.() || null;
    const appliedEventCursors = world?.appliedEventCursors?.() || null;

    return {
      diagnostics: diagnostics
        ? {
            connection: diagnostics.connection,
            eventCursor: diagnostics.eventCursor,
            stream: {
              active: diagnostics.stream?.active === true,
              cursor: diagnostics.stream?.cursor,
            },
            lastOpenedStreamCursor: diagnostics.lastOpenedStreamCursor,
            lastEnvelopeCursor: diagnostics.lastEnvelopeCursor,
            lastAcceptedSnapshotCursor: diagnostics.lastAcceptedSnapshotCursor,
          }
        : null,
      renderer: {
        hasWorldHandle: Boolean(world),
        hasRecentRenderedEventBeats: typeof world?.recentRenderedEventBeats === 'function',
        recentRenderedEventBeats,
        appliedEventCursors,
      },
      presentationChronicleRows: Array.isArray(capturedPresentationState?.chronicleRows)
        ? capturedPresentationState.chronicleRows
        : [],
      currentChronicleRows,
    };
  }, presentationState || null);
}

async function collectLiveRetainedSurfacePresentationState(page) {
  return page.evaluate(async () => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const attr = (node, name) => node?.getAttribute(name) ?? '';
    const toNumber = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const rowState = (row) => ({
      cursor: toNumber(row.getAttribute('data-event-cursor')),
      type: row.getAttribute('data-event-type') ?? '',
      group: row.getAttribute('data-event-group') ?? '',
      tone: row.getAttribute('data-event-tone') ?? '',
      visible: visible(row),
      textLength: (row.textContent || '').replace(/\s+/g, ' ').trim().length,
    });
    const cursorList = (values) => Array.from(new Set((Array.isArray(values) ? values : [])
      .map(toNumber)
      .filter((cursor) => cursor !== null && cursor > 0)));
    const apiEnvelope = await fetch('/api/events?cursor=0', {
      headers: { Accept: 'application/json' },
    }).then(async (response) => ({
      ok: response.ok,
      status: response.status,
      body: await response.json(),
    })).catch((error) => ({
      ok: false,
      status: 0,
      error: error?.name || 'fetch-error',
      body: null,
    }));
    const apiEventCursors = cursorList((apiEnvelope.body?.events ?? []).map((entry) => entry?.cursor));
    const chronicleRows = Array.from(document.querySelectorAll('.chronicle [data-event-kind="event"]')).map(rowState);
    const world = window.__vivariumWorld ?? null;
    const activeEffects = world?.activeEffects?.() ?? [];
    const activeBubbleCursors = cursorList(Array.from(document.querySelectorAll('.viv-event-bubble'))
      .map((bubble) => bubble.getAttribute('data-event-cursor')));
    const activeBubbleEffectCursors = cursorList(activeEffects
      .map((effect) => effect?.bubble?.cursor));
    const retainedAttributes = [
      'data-pulse-retained-event-label',
      'data-pulse-event-label',
      'data-now-retained-event-label',
      'data-now-label',
      'data-now-detail',
      'data-focus-retained-event-label',
      'data-focus-pulse-event-label',
      'data-focus-pulse-detail-text',
    ];
    const retainedAttributeSelector = retainedAttributes.map((name) => `[${name}]`).join(',');
    const rawCopyPattern = /agent_|home_|simulation|provider|model|run_|llm|npc|spawn|prompt|events\/stream|\/api\/|runs\//i;
    const retainedCopyLeaks = Array.from(document.querySelectorAll(retainedAttributeSelector))
      .flatMap((node) => retainedAttributes.map((attribute) => node.getAttribute(attribute)).filter(Boolean))
      .filter((value) => rawCopyPattern.test(value));

    const livePulse = document.querySelector('[data-testid="live-pulse"]');
    const livePulseLatest = livePulse?.querySelector('.live-pulse-latest') ?? null;
    const liveNow = document.querySelector('[data-testid="live-now"]');
    const nowCues = Array.from(liveNow?.querySelectorAll('.live-now-cue') ?? []);

    return {
      diagnostics: window.__vivariumLiveRun?.diagnostics?.() ?? null,
      api: {
        ok: apiEnvelope.ok,
        status: apiEnvelope.status,
        eventCursors: apiEventCursors,
      },
      chronicleRows,
      renderer: {
        hasWorldHandle: Boolean(world),
        livePixels: world?.sampleCanvasPixels?.() ?? 0,
        renderedEventCursors: cursorList(world?.renderedEventCursors?.() ?? []),
        recentRenderedEventBeats: (world?.recentRenderedEventBeats?.() ?? []).map((beat) => ({
          cursor: toNumber(beat?.cursor),
          hasEventType: typeof beat?.eventType === 'string' && beat.eventType.trim().length > 0,
          hasGroup: typeof beat?.group === 'string' && beat.group.trim().length > 0,
          effectCountDelta: Number(beat?.effectCountDelta),
        })),
      },
      transient: {
        activeBubbleCursors,
        activeBubbleEffectCursors,
      },
      livePulse: {
        state: attr(livePulse, 'data-pulse-retention-state'),
        cursor: toNumber(attr(livePulse, 'data-pulse-retained-event-cursor')),
        type: attr(livePulse, 'data-pulse-retained-event-type'),
        visible: visible(livePulse),
        latestVisible: visible(livePulseLatest),
        latestCursor: toNumber(attr(livePulseLatest, 'data-pulse-event-cursor')),
        latestType: attr(livePulseLatest, 'data-pulse-event-type'),
      },
      liveNow: {
        state: attr(liveNow, 'data-now-retention-state'),
        cursor: toNumber(attr(liveNow, 'data-now-retained-event-cursor')),
        type: attr(liveNow, 'data-now-retained-event-type'),
        visible: visible(liveNow),
        cues: nowCues.map((cue) => ({
          cursor: toNumber(attr(cue, 'data-now-cursor')),
          type: attr(cue, 'data-now-event-type'),
          visible: visible(cue),
        })),
      },
      controls: {
        chronicle: document.querySelectorAll('.chronicle button, .chronicle select, .chronicle dialog, .chronicle [role="dialog"], .chronicle [role="button"]').length,
        livePulse: document.querySelectorAll('.live-pulse button, .live-pulse select, .live-pulse dialog, .live-pulse [role="dialog"], .live-pulse [role="button"]').length,
        liveNow: document.querySelectorAll('.live-now button, .live-now select, .live-now dialog, .live-now [role="dialog"], .live-now [role="button"]').length,
        seekCopy: /\b(Seek|Scrub|Playback)\b/i.test(document.body.innerText),
      },
      retainedCopyLeaks,
    };
  });
}

function validateLiveEventPresentationState(state) {
  const failures = [];
  const diagnostics = isPlainObject(state?.diagnostics) ? state.diagnostics : null;
  const eventCursor = Number(diagnostics?.eventCursor);
  const lastEnvelopeCursor = Number(diagnostics?.lastEnvelopeCursor);
  const freshThreshold = liveFreshnessThreshold(diagnostics);

  if (!diagnostics) {
    failures.push('live diagnostics should be available');
  } else if (diagnostics.connection !== 'live') {
    failures.push('live diagnostics should report a live connection');
  }

  if (!Number.isFinite(eventCursor) || eventCursor <= 0) {
    failures.push('live diagnostics are missing a positive event cursor');
  }

  if (diagnostics?.stream?.active !== true) {
    failures.push('live event stream is inactive');
  }

  if (!Number.isFinite(lastEnvelopeCursor) || lastEnvelopeCursor <= 0) {
    failures.push('live diagnostics are missing a positive last envelope cursor');
  }

  if (!Number.isFinite(freshThreshold) || freshThreshold < 0) {
    failures.push('live diagnostics are missing an active stream cursor');
  }

  if (
    Number.isFinite(eventCursor) &&
    eventCursor > 0 &&
    Number.isFinite(freshThreshold) &&
    freshThreshold >= 0 &&
    eventCursor <= freshThreshold
  ) {
    failures.push('live event cursor did not advance beyond the active stream cursor');
  }

  const chronicleRows = Array.isArray(state?.chronicleRows) ? state.chronicleRows : [];
  if (chronicleRows.length === 0) {
    failures.push('chronicle has no live event rows');
    return failures;
  }

  const visibleRows = chronicleRows.filter((row) => row?.visible === true);
  if (visibleRows.length === 0) {
    failures.push('chronicle event rows are not visible');
    return failures;
  }

  const wellFormedVisibleRows = visibleRows.filter((row) => (
    isPositiveFinite(row?.cursor) &&
    nonEmptyString(row?.type) &&
    nonEmptyString(row?.group) &&
    nonEmptyString(row?.tone) &&
    nonEmptyString(row?.text)
  ));
  if (wellFormedVisibleRows.length === 0) {
    failures.push('chronicle event rows are malformed');
    return failures;
  }

  if (
    Number.isFinite(eventCursor) &&
    eventCursor > 0 &&
    wellFormedVisibleRows.every((row) => Number(row.cursor) > eventCursor)
  ) {
    failures.push('chronicle event row cursors do not match live cursor progress');
  }

  if (
    Number.isFinite(freshThreshold) &&
    freshThreshold >= 0 &&
    Number.isFinite(eventCursor) &&
    eventCursor > 0 &&
    eventCursor > freshThreshold &&
    !wellFormedVisibleRows.some((row) => {
      const cursor = Number(row.cursor);
      return cursor > freshThreshold && cursor <= eventCursor;
    })
  ) {
    failures.push('chronicle has no fresh live stream rows');
  }

  return failures;
}

function validateLiveRendererFreshnessState(state) {
  const failures = [];
  const diagnostics = isPlainObject(state?.diagnostics) ? state.diagnostics : null;
  const renderer = isPlainObject(state?.renderer) ? state.renderer : {};
  const eventCursor = Number(diagnostics?.eventCursor);
  const lastEnvelopeCursor = Number(diagnostics?.lastEnvelopeCursor);
  const freshThreshold = liveFreshnessThreshold(diagnostics);

  if (!diagnostics) {
    failures.push('live diagnostics should be available');
  } else if (diagnostics.connection !== 'live') {
    failures.push('live diagnostics should report a live connection');
  }

  if (!Number.isFinite(eventCursor) || eventCursor <= 0) {
    failures.push('live diagnostics are missing a positive event cursor');
  }

  if (diagnostics?.stream?.active !== true) {
    failures.push('live event stream is inactive');
  }

  if (!Number.isFinite(lastEnvelopeCursor) || lastEnvelopeCursor <= 0) {
    failures.push('live diagnostics are missing a positive last envelope cursor');
  }

  if (!Number.isFinite(freshThreshold) || freshThreshold < 0) {
    failures.push('live diagnostics are missing an active stream cursor');
  }

  if (renderer.hasWorldHandle !== true) {
    failures.push('renderer debug handle should be available');
  }

  if (renderer.hasRecentRenderedEventBeats !== true) {
    failures.push('renderer debug handle is missing rendered beat freshness');
  }

  const beats = Array.isArray(renderer.recentRenderedEventBeats)
    ? renderer.recentRenderedEventBeats
    : [];
  if (beats.length === 0) {
    failures.push('renderer has no recent rendered event beats');
    return failures;
  }

  const wellFormedBeats = beats.filter((beat) => renderedBeatProblems(beat, eventCursor, freshThreshold).length === 0);
  if (wellFormedBeats.length === 0) {
    failures.push('renderer rendered beat entries are not fresh live effects');
    return failures;
  }

  const freshChronicleCursors = freshPresentedChronicleCursors(state, eventCursor, freshThreshold);
  if (
    freshChronicleCursors.length > 0 &&
    !wellFormedBeats.some((beat) => freshChronicleCursors.includes(Number(beat.cursor)))
  ) {
    failures.push('renderer fresh beat cursors do not match presented chronicle freshness');
  }

  return failures;
}

function validateLiveRetainedSurfacePresentationState(state) {
  const failures = [];
  const diagnostics = isPlainObject(state?.diagnostics) ? state.diagnostics : null;
  const eventCursor = Number(diagnostics?.eventCursor);
  const lastEnvelopeCursor = Number(diagnostics?.lastEnvelopeCursor);
  const freshThreshold = liveFreshnessThreshold(diagnostics);

  if (!diagnostics) {
    failures.push('live diagnostics should be available');
  } else if (diagnostics.connection !== 'live') {
    failures.push('live diagnostics should report a live connection');
  }

  if (!Number.isFinite(eventCursor) || eventCursor <= 0) {
    failures.push('live diagnostics are missing a positive event cursor');
  }

  if (diagnostics?.stream?.active !== true) {
    failures.push('live event stream is inactive');
  }

  if (!Number.isFinite(lastEnvelopeCursor) || lastEnvelopeCursor <= 0) {
    failures.push('live diagnostics are missing a positive last envelope cursor');
  }

  if (!Number.isFinite(freshThreshold) || freshThreshold < 0) {
    failures.push('live diagnostics are missing an active stream cursor');
  }

  const apiCursors = cursorSet(state?.api?.eventCursors);
  if (state?.api?.ok !== true || apiCursors.size === 0) {
    failures.push('external live retained proof should fetch API event cursors');
  }

  const chronicleRows = Array.isArray(state?.chronicleRows) ? state.chronicleRows : [];
  const visibleRows = chronicleRows.filter((row) => (
    row?.visible === true &&
    Number.isFinite(row?.cursor) &&
    row.cursor > 0 &&
    nonEmptyString(row?.type) &&
    nonEmptyString(row?.group) &&
    nonEmptyString(row?.tone) &&
    Number(row?.textLength) > 0
  ));
  if (visibleRows.length === 0) {
    failures.push('chronicle should retain visible well-formed live event rows');
  }

  const renderer = isPlainObject(state?.renderer) ? state.renderer : {};
  const renderedCursors = cursorSet(renderer.renderedEventCursors);
  if (renderer.hasWorldHandle !== true) {
    failures.push('renderer debug handle should be available');
  }
  if (renderedCursors.size === 0) {
    failures.push('renderer debug handle should expose retained event cursor memory');
  }
  if (!Number.isFinite(Number(renderer.livePixels)) || Number(renderer.livePixels) <= 20) {
    failures.push('renderer should expose visible live world pixels');
  }

  validateRetainedSurface(failures, 'World pulse', state?.livePulse, {
    required: true,
    latestCursorKey: 'latestCursor',
    latestTypeKey: 'latestType',
    apiCursors,
    visibleRows,
    renderedCursors,
    activeBubbleCursors: cursorSet(state?.transient?.activeBubbleCursors),
    activeBubbleEffectCursors: cursorSet(state?.transient?.activeBubbleEffectCursors),
    eventCursor,
    freshThreshold,
  });
  validateRetainedSurface(failures, 'Now cue surface', state?.liveNow, {
    required: true,
    apiCursors,
    visibleRows,
    renderedCursors,
    activeBubbleCursors: cursorSet(state?.transient?.activeBubbleCursors),
    activeBubbleEffectCursors: cursorSet(state?.transient?.activeBubbleEffectCursors),
    eventCursor,
    freshThreshold,
    cueListKey: 'cues',
  });

  const controls = state?.controls ?? {};
  for (const [surface, count] of Object.entries(controls)) {
    if (surface === 'seekCopy') {
      if (count === true) failures.push('retained external smoke should not expose seek/scrub/playback copy');
      continue;
    }
    if (count !== 0) {
      failures.push(`${surface} should not introduce controls or dialogs`);
    }
  }

  if (Array.isArray(state?.retainedCopyLeaks) && state.retainedCopyLeaks.length > 0) {
    failures.push('retained live surface attributes should not expose backend/raw vocabulary');
  }

  return failures;
}

function validateRetainedSurface(failures, label, surface, options) {
  const cursor = Number(surface?.cursor);
  const type = surface?.type;
  const required = options.required === true;

  if (surface?.visible !== true) {
    failures.push(`${label} should stay visible`);
  }
  if (surface?.state !== 'retained') {
    if (required) failures.push(`${label} should expose retained state`);
    return;
  }
  if (!Number.isFinite(cursor) || cursor <= 0 || !nonEmptyString(type) || type === 'none') {
    failures.push(`${label} should expose retained cursor/type metadata`);
    return;
  }
  if (
    !Number.isFinite(options.eventCursor) ||
    cursor > options.eventCursor ||
    !Number.isFinite(options.freshThreshold) ||
    cursor <= options.freshThreshold
  ) {
    failures.push(`${label} should retain a fresh live event cursor`);
  }
  if (!options.apiCursors.has(cursor) || !options.renderedCursors.has(cursor)) {
    failures.push(`${label} retained cursor should match API and renderer evidence`);
  }
  if (!options.visibleRows.some((row) => row.cursor === cursor && row.type === type)) {
    failures.push(`${label} retained cursor/type should match a visible chronicle row`);
  }
  if (options.activeBubbleCursors.has(cursor) || options.activeBubbleEffectCursors.has(cursor)) {
    failures.push(`${label} retained event should no longer have active bubble UI`);
  }

  if (options.latestCursorKey && options.latestTypeKey) {
    if (surface.latestVisible !== true) {
      failures.push(`${label} latest retained row should stay visible`);
    }
    if (surface.cursor !== surface[options.latestCursorKey] || surface.type !== surface[options.latestTypeKey]) {
      failures.push(`${label} parent retained metadata should match latest row metadata`);
    }
  }

  if (options.cueListKey) {
    const matchingCue = (surface?.[options.cueListKey] ?? []).some((cue) => (
      cue.visible === true &&
      cue.cursor === cursor &&
      cue.type === type
    ));
    if (!matchingCue) {
      failures.push(`${label} retained metadata should match a visible cue`);
    }
  }
}

function assertLiveEventPresentationState(state) {
  const failures = validateLiveEventPresentationState(state);
  expect(
    failures,
    formatLiveEventPresentationFailure(failures, state),
  ).toEqual([]);
}

function assertLiveRendererFreshnessState(state) {
  const failures = validateLiveRendererFreshnessState(state);
  expect(
    failures,
    formatLiveRendererFreshnessFailure(failures, state),
  ).toEqual([]);
}

function assertLiveRetainedSurfacePresentationState(state) {
  const failures = validateLiveRetainedSurfacePresentationState(state);
  expect(
    failures,
    formatLiveRetainedSurfacePresentationFailure(failures, state),
  ).toEqual([]);
}

function formatLiveEventPresentationFailure(failures, state) {
  const snapshot = sanitizeLiveEventPresentationState(state);
  const summary = failures.length > 0
    ? failures.map((failure) => `- ${failure}`).join('\n')
    : '- none';
  return [
    'Expected live provider to present at least one generic live chronicle event.',
    'Failures:',
    summary,
    `Diagnostics: ${formatDiagnosticSummary(snapshot.diagnostics)}`,
    `Chronicle: ${formatChronicleSummary(snapshot.chronicle)}`,
    `Renderer hints: eventBubbles=${snapshot.eventBubbleCount}, activeEventEffects=${snapshot.activeEventEffectCount}, inspectorRows=${snapshot.inspectorRowCount}`,
    `Chronicle samples: ${JSON.stringify(snapshot.chronicleRows)}`,
  ].join('\n');
}

function formatLiveRendererFreshnessFailure(failures, state) {
  const snapshot = sanitizeLiveRendererFreshnessState(state);
  const summary = failures.length > 0
    ? failures.map((failure) => `- ${failure}`).join('\n')
    : '- none';
  return [
    'Expected live provider to render at least one fresh generic event beat.',
    'Failures:',
    summary,
    `Diagnostics: ${formatDiagnosticSummary(snapshot.diagnostics)}`,
    `Renderer: ${formatRendererFreshnessSummary(snapshot.renderer)}`,
    `Chronicle: ${formatChronicleSummary(snapshot.chronicle)}`,
    `Rendered beat samples: ${JSON.stringify(snapshot.recentRenderedEventBeats)}`,
  ].join('\n');
}

function formatLiveRetainedSurfacePresentationFailure(failures, state) {
  const snapshot = sanitizeLiveRetainedSurfacePresentationState(state);
  const summary = failures.length > 0
    ? failures.map((failure) => `- ${failure}`).join('\n')
    : '- none';
  return [
    'Expected live provider to retain a generic live event after transient presentation.',
    'Failures:',
    summary,
    `Diagnostics: ${formatDiagnosticSummary(snapshot.diagnostics)}`,
    `API cursors: ${formatCursorSetSummary(snapshot.apiCursors)}`,
    `Chronicle: ${formatChronicleSummary(snapshot.chronicle)}`,
    `Renderer memory: ${formatCursorSetSummary(snapshot.renderedCursors)} livePixels=${snapshot.livePixels}`,
    `Transient bubbles: dom=${formatCursorSetSummary(snapshot.activeBubbleCursors)} effects=${formatCursorSetSummary(snapshot.activeBubbleEffectCursors)}`,
    `World pulse: ${formatRetainedSurfaceSummary(snapshot.livePulse)}`,
    `Now: ${formatRetainedSurfaceSummary(snapshot.liveNow)}`,
    `Controls: ${JSON.stringify(snapshot.controls)}`,
    `Retained copy leaks: ${countBucket(snapshot.retainedCopyLeakCount)}`,
  ].join('\n');
}

function sanitizeLiveEventPresentationState(state) {
  const chronicleRows = Array.isArray(state?.chronicleRows) ? state.chronicleRows : [];
  const inspectorRows = Array.isArray(state?.inspectorRows) ? state.inspectorRows : [];
  const eventCursor = Number(state?.diagnostics?.eventCursor);
  const freshThreshold = liveFreshnessThreshold(state?.diagnostics);
  const rowSummaries = chronicleRows.map((row, index) => (
    sanitizePresentationRow(row, index, eventCursor, freshThreshold)
  ));

  return {
    diagnostics: sanitizeDiagnostics(state?.diagnostics),
    chronicle: summarizePresentationRows(rowSummaries, freshThreshold, eventCursor),
    chronicleRowCount: chronicleRows.length,
    chronicleRows: rowSummaries.slice(0, 5),
    omittedChronicleRowCount: Math.max(0, chronicleRows.length - 5),
    inspectorRowCount: inspectorRows.length,
    eventBubbleCount: boundedCount(state?.eventBubbleCount),
    activeEventEffectCount: boundedCount(state?.activeEventEffectCount),
  };
}

function sanitizeLiveRetainedSurfacePresentationState(state) {
  const diagnostics = isPlainObject(state?.diagnostics) ? state.diagnostics : null;
  const eventCursor = Number(diagnostics?.eventCursor);
  const freshThreshold = liveFreshnessThreshold(diagnostics);
  const rowSummaries = (Array.isArray(state?.chronicleRows) ? state.chronicleRows : [])
    .map((row, index) => sanitizePresentationRow({
      cursor: row?.cursor,
      type: row?.type,
      group: row?.group,
      tone: row?.tone,
      text: Number(row?.textLength) > 0 ? 'x'.repeat(Math.min(48, Number(row.textLength))) : '',
      visible: row?.visible,
    }, index, eventCursor, freshThreshold));

  return {
    diagnostics: sanitizeDiagnostics(diagnostics),
    apiCursors: summarizeCursorSet(state?.api?.eventCursors),
    chronicle: summarizePresentationRows(rowSummaries, freshThreshold, eventCursor),
    livePixels: boundedCount(state?.renderer?.livePixels),
    renderedCursors: summarizeCursorSet(state?.renderer?.renderedEventCursors),
    activeBubbleCursors: summarizeCursorSet(state?.transient?.activeBubbleCursors),
    activeBubbleEffectCursors: summarizeCursorSet(state?.transient?.activeBubbleEffectCursors),
    livePulse: sanitizeRetainedSurface(state?.livePulse, rowSummaries, state),
    liveNow: sanitizeRetainedSurface(state?.liveNow, rowSummaries, state),
    controls: sanitizeControls(state?.controls),
    retainedCopyLeakCount: Array.isArray(state?.retainedCopyLeaks) ? state.retainedCopyLeaks.length : 0,
  };
}

function sanitizeLiveRendererFreshnessState(state) {
  const diagnostics = isPlainObject(state?.diagnostics) ? state.diagnostics : null;
  const eventCursor = Number(diagnostics?.eventCursor);
  const freshThreshold = liveFreshnessThreshold(diagnostics);
  const renderer = isPlainObject(state?.renderer) ? state.renderer : {};
  const beats = Array.isArray(renderer.recentRenderedEventBeats)
    ? renderer.recentRenderedEventBeats
    : [];
  const beatSummaries = beats.map((beat, index) => (
    sanitizeRenderedBeat(beat, index, eventCursor, freshThreshold)
  ));
  const chronicleRows = [
    ...presentationRowsForFreshness(state?.presentationChronicleRows),
    ...presentationRowsForFreshness(state?.currentChronicleRows),
  ];
  const rowSummaries = chronicleRows.map((row, index) => (
    sanitizePresentationRow(row, index, eventCursor, freshThreshold)
  ));

  return {
    diagnostics: sanitizeDiagnostics(diagnostics),
    renderer: summarizeRenderedBeats(
      beatSummaries,
      renderer,
      freshThreshold,
      eventCursor,
    ),
    chronicle: summarizePresentationRows(rowSummaries, freshThreshold, eventCursor),
    recentRenderedEventBeats: beatSummaries.slice(0, 5),
    omittedRenderedBeatCount: Math.max(0, beatSummaries.length - 5),
  };
}

function sanitizeRetainedSurface(surface, rowSummaries, state) {
  const cursor = Number(surface?.cursor);
  const type = surface?.type;
  const rowMatch = (Array.isArray(state?.chronicleRows) ? state.chronicleRows : []).some((row) => (
    row?.visible === true &&
    row.cursor === cursor &&
    row.type === type
  ));
  return {
    state: surface?.state ?? 'missing',
    visible: surface?.visible === true,
    cursor: sanitizeCursor(surface?.cursor),
    hasType: nonEmptyString(surface?.type) && surface.type !== 'none',
    rowMatch,
    latestMatch: surface?.latestCursor === undefined
      ? null
      : surface.cursor === surface.latestCursor && surface.type === surface.latestType,
    cueMatch: Array.isArray(surface?.cues)
      ? surface.cues.some((cue) => cue.visible === true && cue.cursor === cursor && cue.type === type)
      : null,
  };
}

function sanitizeControls(controls) {
  return {
    chronicle: boundedCount(controls?.chronicle),
    livePulse: boundedCount(controls?.livePulse),
    liveNow: boundedCount(controls?.liveNow),
    seekCopy: controls?.seekCopy === true,
  };
}

function summarizePresentationRows(rowSummaries, freshThreshold, eventCursor) {
  const rows = Array.isArray(rowSummaries) ? rowSummaries : [];
  const cursors = rows
    .map((row) => row.cursor)
    .filter((cursor) => Number.isFinite(cursor));
  const freshRows = rows.filter((row) => (
    Number.isFinite(freshThreshold) &&
    freshThreshold >= 0 &&
    Number.isFinite(eventCursor) &&
    eventCursor > 0 &&
    row.visible === true &&
    row.hasType === true &&
    row.hasGroup === true &&
    row.hasTone === true &&
    row.textLength > 0 &&
    Number.isFinite(row.cursor) &&
    row.cursor > freshThreshold &&
    row.cursor <= eventCursor
  ));
  const freshCursors = freshRows
    .map((row) => row.cursor)
    .filter((cursor) => Number.isFinite(cursor));

  return {
    rowCount: rows.length,
    visibleRows: rows.filter((row) => row.visible).length,
    matchingRows: rows.filter((row) => row.problems.length === 0).length,
    hiddenRows: rows.filter((row) => row.problems.includes('not-visible')).length,
    malformedRows: rows.filter((row) => row.problems.some((problem) => (
      problem === 'missing-type' ||
      problem === 'missing-group' ||
      problem === 'missing-tone' ||
      problem === 'missing-text' ||
      problem === 'missing-positive-cursor'
    ))).length,
    futureCursorRows: rows.filter((row) => row.problems.includes('cursor-ahead-of-live-progress')).length,
    staleRows: rows.filter((row) => row.problems.includes('not-fresh-for-active-stream')).length,
    freshThreshold: Number.isFinite(freshThreshold) && freshThreshold >= 0
      ? freshThreshold
      : null,
    freshRows: freshRows.length,
    freshCursorRange: freshCursors.length > 0
      ? { min: Math.min(...freshCursors), max: Math.max(...freshCursors) }
      : null,
    cursorRange: cursors.length > 0
      ? { min: Math.min(...cursors), max: Math.max(...cursors) }
      : null,
  };
}

function summarizeRenderedBeats(beatSummaries, renderer, freshThreshold, eventCursor) {
  const beats = Array.isArray(beatSummaries) ? beatSummaries : [];
  const cursors = beats
    .map((beat) => beat.cursor)
    .filter((cursor) => Number.isFinite(cursor));
  const freshBeats = beats.filter((beat) => (
    Number.isFinite(freshThreshold) &&
    freshThreshold >= 0 &&
    Number.isFinite(eventCursor) &&
    eventCursor > 0 &&
    Number.isFinite(beat.cursor) &&
    beat.cursor > freshThreshold &&
    beat.cursor <= eventCursor &&
    beat.effectBucket !== 'none' &&
    beat.problems.length === 0
  ));
  const freshCursors = freshBeats
    .map((beat) => beat.cursor)
    .filter((cursor) => Number.isFinite(cursor));
  const appliedCursors = Array.isArray(renderer?.appliedEventCursors)
    ? renderer.appliedEventCursors
        .map((cursor) => Number(cursor))
        .filter((cursor) => Number.isFinite(cursor) && cursor > 0)
    : [];

  return {
    hasWorldHandle: renderer?.hasWorldHandle === true,
    hasRecentRenderedEventBeats: renderer?.hasRecentRenderedEventBeats === true,
    beatCount: beats.length,
    freshThreshold: Number.isFinite(freshThreshold) && freshThreshold >= 0
      ? freshThreshold
      : null,
    freshBeats: freshBeats.length,
    staleBeats: beats.filter((beat) => beat.problems.includes('not-fresh-for-active-stream')).length,
    futureCursorBeats: beats.filter((beat) => beat.problems.includes('cursor-ahead-of-live-progress')).length,
    inertBeats: beats.filter((beat) => beat.problems.includes('no-rendered-effect')).length,
    malformedBeats: beats.filter((beat) => beat.problems.some((problem) => (
      problem === 'missing-positive-cursor' ||
      problem === 'missing-event-type' ||
      problem === 'missing-group'
    ))).length,
    appliedCursorCount: appliedCursors.length,
    appliedCursorRange: appliedCursors.length > 0
      ? { min: Math.min(...appliedCursors), max: Math.max(...appliedCursors) }
      : null,
    freshCursorRange: freshCursors.length > 0
      ? { min: Math.min(...freshCursors), max: Math.max(...freshCursors) }
      : null,
    cursorRange: cursors.length > 0
      ? { min: Math.min(...cursors), max: Math.max(...cursors) }
      : null,
  };
}

function sanitizeDiagnostics(diagnostics) {
  if (!isPlainObject(diagnostics)) {
    return null;
  }

  return {
    connection: diagnostics.connection === 'live' ? 'live' : normalizePresence(diagnostics.connection),
    eventCursor: sanitizeCursor(diagnostics.eventCursor),
    stream: {
      active: diagnostics.stream?.active === true,
      cursor: sanitizeCursor(diagnostics.stream?.cursor),
    },
    lastOpenedStreamCursor: sanitizeCursor(diagnostics.lastOpenedStreamCursor),
    lastEnvelopeCursor: sanitizeCursor(diagnostics.lastEnvelopeCursor),
    lastAcceptedSnapshotCursor: sanitizeCursor(diagnostics.lastAcceptedSnapshotCursor),
  };
}

function sanitizeRenderedBeat(beat, index, eventCursor, freshThreshold) {
  const summaryKinds = Array.isArray(beat?.summaryKinds) ? beat.summaryKinds : [];
  return {
    index,
    cursor: sanitizeCursor(beat?.cursor),
    hasEventType: nonEmptyString(beat?.eventType),
    hasGroup: nonEmptyString(beat?.group),
    hasBubble: beat?.hasBubble === true,
    hasPulse: beat?.hasPulse === true,
    hasArc: beat?.hasArc === true,
    hasSpecial: beat?.hasSpecial === true,
    effectBucket: countBucket(beat?.effectCountDelta),
    summaryBucket: countBucket(beat?.summaryCount ?? summaryKinds.length),
    problems: renderedBeatProblems(beat, eventCursor, freshThreshold),
  };
}

function sanitizePresentationRow(row, index, eventCursor, freshThreshold) {
  return {
    index,
    cursor: sanitizeCursor(row?.cursor),
    visible: row?.visible === true,
    hasType: nonEmptyString(row?.type),
    hasGroup: nonEmptyString(row?.group),
    hasTone: nonEmptyString(row?.tone),
    textLength: nonEmptyString(row?.text) ? row.text.length : 0,
    problems: presentationRowProblems(row, eventCursor, freshThreshold),
  };
}

function renderedBeatProblems(beat, eventCursor, freshThreshold) {
  const problems = [];
  const cursor = Number(beat?.cursor);

  if (!Number.isFinite(cursor) || cursor <= 0) {
    problems.push('missing-positive-cursor');
  } else if (Number.isFinite(eventCursor) && eventCursor > 0 && cursor > eventCursor) {
    problems.push('cursor-ahead-of-live-progress');
  } else if (
    Number.isFinite(freshThreshold) &&
    freshThreshold >= 0 &&
    cursor <= freshThreshold
  ) {
    problems.push('not-fresh-for-active-stream');
  }

  if (!nonEmptyString(beat?.eventType)) {
    problems.push('missing-event-type');
  }
  if (!nonEmptyString(beat?.group)) {
    problems.push('missing-group');
  }
  if (!Number.isFinite(Number(beat?.effectCountDelta)) || Number(beat.effectCountDelta) <= 0) {
    problems.push('no-rendered-effect');
  }

  return problems;
}

function freshPresentedChronicleCursors(state, eventCursor, freshThreshold) {
  return Array.from(new Set(
    [
      ...presentationRowsForFreshness(state?.presentationChronicleRows),
      ...presentationRowsForFreshness(state?.currentChronicleRows),
    ]
      .filter((row) => presentationRowProblems(row, eventCursor, freshThreshold).length === 0)
      .map((row) => Number(row.cursor))
      .filter((cursor) => Number.isFinite(cursor) && cursor > 0),
  ));
}

function presentationRowsForFreshness(rows) {
  return Array.isArray(rows) ? rows : [];
}

function presentationRowProblems(row, eventCursor, freshThreshold) {
  const problems = [];
  const cursor = Number(row?.cursor);

  if (!Number.isFinite(cursor) || cursor <= 0) {
    problems.push('missing-positive-cursor');
  } else if (Number.isFinite(eventCursor) && eventCursor > 0 && cursor > eventCursor) {
    problems.push('cursor-ahead-of-live-progress');
  } else if (
    Number.isFinite(freshThreshold) &&
    freshThreshold >= 0 &&
    cursor <= freshThreshold
  ) {
    problems.push('not-fresh-for-active-stream');
  }

  if (row?.visible !== true) {
    problems.push('not-visible');
  }

  if (!nonEmptyString(row?.type)) {
    problems.push('missing-type');
  }
  if (!nonEmptyString(row?.group)) {
    problems.push('missing-group');
  }
  if (!nonEmptyString(row?.tone)) {
    problems.push('missing-tone');
  }
  if (!nonEmptyString(row?.text)) {
    problems.push('missing-text');
  }

  return problems;
}

function liveFreshnessThreshold(diagnostics) {
  const streamCursor = Number(diagnostics?.stream?.cursor);
  if (Number.isFinite(streamCursor) && streamCursor >= 0) {
    return streamCursor;
  }

  const openedCursor = Number(diagnostics?.lastOpenedStreamCursor);
  if (Number.isFinite(openedCursor) && openedCursor >= 0) {
    return openedCursor;
  }

  return null;
}

function formatLiveEventCursorCorrelationFailure(details = {}) {
  const api = summarizeCursorSet(details.apiEventCursors);
  const presented = summarizeCursorSet(details.presentedChronicleCursors);

  return [
    'Expected at least one presented chronicle event cursor to match /api/events?cursor=0.',
    `API cursors: ${formatCursorSetSummary(api)}`,
    `Presented chronicle cursors: ${formatCursorSetSummary(presented)}`,
  ].join('\n');
}

function summarizeCursorSet(values) {
  const cursors = Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0),
  )).sort((left, right) => left - right);

  return {
    count: cursors.length,
    range: cursors.length > 0
      ? { min: cursors[0], max: cursors[cursors.length - 1] }
      : null,
    sample: cursors.slice(0, 8),
    omitted: Math.max(0, cursors.length - 8),
  };
}

function formatDiagnosticSummary(diagnostics) {
  if (!diagnostics) {
    return 'unavailable';
  }

  return [
    `connection=${diagnostics.connection ?? 'null'}`,
    `stream.active=${diagnostics.stream?.active === true}`,
    `stream.cursor=${diagnostics.stream?.cursor ?? 'null'}`,
    `lastOpenedStreamCursor=${diagnostics.lastOpenedStreamCursor ?? 'null'}`,
    `eventCursor=${diagnostics.eventCursor ?? 'null'}`,
    `lastEnvelopeCursor=${diagnostics.lastEnvelopeCursor ?? 'null'}`,
    `lastAcceptedSnapshotCursor=${diagnostics.lastAcceptedSnapshotCursor ?? 'null'}`,
  ].join(' ');
}

function formatChronicleSummary(summary) {
  if (!summary) {
    return 'unavailable';
  }

  const cursorRange = summary.cursorRange
    ? `${summary.cursorRange.min}..${summary.cursorRange.max}`
    : 'none';
  const freshCursorRange = summary.freshCursorRange
    ? `${summary.freshCursorRange.min}..${summary.freshCursorRange.max}`
    : 'none';
  return [
    `rows=${summary.rowCount}`,
    `visibleRows=${summary.visibleRows}`,
    `matchingRows=${summary.matchingRows}`,
    `hiddenRows=${summary.hiddenRows}`,
    `malformedRows=${summary.malformedRows}`,
    `futureCursorRows=${summary.futureCursorRows}`,
    `staleRows=${summary.staleRows}`,
    `freshThreshold=${summary.freshThreshold ?? 'null'}`,
    `freshRows=${summary.freshRows}`,
    `freshCursorRange=${freshCursorRange}`,
    `cursorRange=${cursorRange}`,
  ].join(' ');
}

function formatRendererFreshnessSummary(summary) {
  if (!summary) {
    return 'unavailable';
  }

  const cursorRange = summary.cursorRange
    ? `${summary.cursorRange.min}..${summary.cursorRange.max}`
    : 'none';
  const freshCursorRange = summary.freshCursorRange
    ? `${summary.freshCursorRange.min}..${summary.freshCursorRange.max}`
    : 'none';
  const appliedCursorRange = summary.appliedCursorRange
    ? `${summary.appliedCursorRange.min}..${summary.appliedCursorRange.max}`
    : 'none';
  return [
    `hasWorldHandle=${summary.hasWorldHandle === true}`,
    `hasRecentRenderedEventBeats=${summary.hasRecentRenderedEventBeats === true}`,
    `beats=${countBucket(summary.beatCount)}`,
    `freshThreshold=${summary.freshThreshold ?? 'null'}`,
    `freshBeats=${countBucket(summary.freshBeats)}`,
    `staleBeats=${countBucket(summary.staleBeats)}`,
    `futureCursorBeats=${countBucket(summary.futureCursorBeats)}`,
    `inertBeats=${countBucket(summary.inertBeats)}`,
    `malformedBeats=${countBucket(summary.malformedBeats)}`,
    `appliedCursors=${countBucket(summary.appliedCursorCount)}`,
    `appliedCursorRange=${appliedCursorRange}`,
    `freshCursorRange=${freshCursorRange}`,
    `cursorRange=${cursorRange}`,
  ].join(' ');
}

function formatCursorSetSummary(summary) {
  const range = summary.range ? `${summary.range.min}..${summary.range.max}` : 'none';
  const sample = summary.sample.length > 0 ? summary.sample.join(',') : 'none';
  return `count=${summary.count} range=${range} sample=${sample} omitted=${summary.omitted}`;
}

function formatRetainedSurfaceSummary(surface) {
  if (!surface) {
    return 'unavailable';
  }
  return [
    `state=${surface.state ?? 'missing'}`,
    `visible=${surface.visible === true}`,
    `cursor=${surface.cursor ?? 'null'}`,
    `hasType=${surface.hasType === true}`,
    `rowMatch=${surface.rowMatch === true}`,
    `latestMatch=${surface.latestMatch === null ? 'n/a' : surface.latestMatch === true}`,
    `cueMatch=${surface.cueMatch === null ? 'n/a' : surface.cueMatch === true}`,
  ].join(' ');
}

function cursorSet(values) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0),
  );
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveFinite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function sanitizeCursor(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 'invalid';
}

function boundedCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function countBucket(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 'none';
  }
  return parsed === 1 ? 'one' : 'many';
}

function normalizePresence(value) {
  return value === null || value === undefined || value === '' ? null : 'present';
}

function positiveTimeout(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  REQUIRED_RUN_CONSTANT_KEYS,
  RAW_RUN_METADATA_COPY_LABELS,
  bannedBackendVocabularyPattern,
  fetchRunMetadata,
  fetchWorldSnapshot,
  fetchJsonlArtifact,
  byField,
  buildRawRunMetadataBannedCopy,
  expectRunConstants,
  expectRunEnvelopeConstants,
  expectLiveEventPresentation,
  expectLiveRendererFreshness,
  expectLiveRetainedSurfacePresentation,
  formatLiveEventCursorCorrelationFailure,
  expectNoBannedObserverCopy,
  expectNoLiveDiagnosticCopy,
  expectNoRawRunMetadataCopy,
  _test: {
    formatLiveEventPresentationFailure,
    formatLiveRendererFreshnessFailure,
    formatLiveRetainedSurfacePresentationFailure,
    formatLiveEventCursorCorrelationFailure,
    sanitizeLiveEventPresentationState,
    sanitizeLiveRendererFreshnessState,
    sanitizeLiveRetainedSurfacePresentationState,
    validateLiveEventPresentationState,
    validateLiveRendererFreshnessState,
    validateLiveRetainedSurfacePresentationState,
  },
};
