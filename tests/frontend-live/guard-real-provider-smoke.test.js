const assert = require('node:assert/strict');
const test = require('node:test');

const { files, runGuard } = require('./guard-real-provider-smoke');

const deterministicLiveTitle = 'production app observes the real deterministic live API and SSE stream';
const deterministicBuiltTitle = 'built frontend observes the real deterministic live API and SSE stream';
const externalRealProviderTitle = 'external real-provider frontend observes a live sim without deterministic harnesses';
const rendererSummaryDiagnosticReferences = Object.freeze([
  'LIVE_RENDERER_SUMMARY_KIND_POOL',
  'LIVE_RENDERER_REQUIRED_TAIL_SUMMARIES',
  'LIVE_RENDERER_RAW_SUMMARY_FIELDS',
  'LIVE_RENDERER_SUMMARY_TUPLE_FIELDS',
  'LIVE_RENDERER_SUMMARY_TUPLE_ARRAY_FIELDS',
  'LIVE_RENDERER_MOTION_MODE_SUMMARY_KINDS',
]);

const goodSources = Object.freeze({
  [files.realProviderSpec]: `
    const {
      fetchWorldSnapshot,
      expectLiveEventPresentation,
      expectLiveRetainedSurfacePresentation,
      expectLiveRendererFreshness,
      expectNoBannedObserverCopy,
      expectNoRawRunMetadataCopy,
      formatLiveEventCursorCorrelationFailure,
    } = require('./live-common-helpers');

    test('${externalRealProviderTitle}', async () => {
      expectNoBannedObserverCopy();
      const presentationState = await expectLiveEventPresentation(page);
      await expectLiveRendererFreshness(page, presentationState);
      await expectLiveRetainedSurfacePresentation(page);
      await expectNoRawRunMetadataCopy(page, ['seed-7-private']);
      await fetch('/api/run');
      await fetchWorldSnapshot();
      const eventsEnvelope = await page.evaluate(async () => {
        const response = await fetch('/api/events?cursor=0', {
          headers: { Accept: 'application/json' },
        });
        return {
          ok: response.ok,
          status: response.status,
          body: await response.json(),
        };
      });
      const apiEventCursors = eventsEnvelope.body.events
        .map((entry) => entry.cursor)
        .filter((cursor) => Number.isFinite(cursor) && cursor > 0);
      const apiEventCursorSet = new Set(apiEventCursors);
      const presentedChronicleCursors = presentationState.chronicleRows
        .map((row) => row.cursor)
        .filter((cursor) => Number.isFinite(cursor) && cursor > 0);
      expect(
        presentedChronicleCursors.some((cursor) => apiEventCursorSet.has(cursor)),
        formatLiveEventCursorCorrelationFailure({
          apiEventCursors,
          presentedChronicleCursors,
        }),
      ).toBe(true);
      void presentationState;
    });
  `,
  [files.deterministicLiveSpec]: deterministicRawMetadataSpecFixture(deterministicLiveTitle),
  [files.deterministicBuiltSpec]: deterministicRawMetadataSpecFixture(deterministicBuiltTitle),
  [files.commonHelpers]: `
    async function fetchWorldSnapshot() {}
    function buildRawRunMetadataBannedCopy() {}
    async function expectNoBannedObserverCopy() {}
    async function expectLiveEventPresentation() {}
    async function expectLiveRendererFreshness() {}
    async function expectLiveRetainedSurfacePresentation() {}
    async function expectNoRawRunMetadataCopy() {}
    function formatLiveEventCursorCorrelationFailure() {}
    module.exports = {
      fetchWorldSnapshot,
      buildRawRunMetadataBannedCopy,
      expectNoBannedObserverCopy,
      expectLiveEventPresentation,
      expectLiveRendererFreshness,
      expectLiveRetainedSurfacePresentation,
      expectNoRawRunMetadataCopy,
      formatLiveEventCursorCorrelationFailure,
    };
  `,
  [files.rendererSummaryDiagnostics]: rendererSummaryDiagnosticsFixture(
    rendererSummaryDiagnosticReferences,
  ),
  [files.realLiveConfig]: `
    module.exports = {
      testMatch: /live-real-provider\\.spec\\.js/,
      use: { baseURL: process.env.VIVARIUM_REAL_LIVE_FRONTEND_URL },
    };
  `,
  [files.deterministicLiveConfig]: `
    module.exports = {
      testMatch: /live-real-api\\.spec\\.js/,
    };
  `,
  [files.deterministicBuiltConfig]: `
    module.exports = {
      testMatch: /live-built-real-api\\.spec\\.js/,
    };
  `,
});

test('guard passes generic external smoke boundaries', () => {
  assert.deepEqual(runGuard({ readFile: fixtureReader() }), []);
});

for (const routeOwner of ['page', 'context']) {
  test(`guard rejects ${routeOwner}.route mocks in the external spec`, () => {
    const failures = runFixture({
      [files.realProviderSpec]: externalRealProviderSpecWithInjection(`
        await ${routeOwner}['route']('**/api/**', () => {});
      `),
    });

    assertFailureIncludes(failures, `${routeOwner}.route`);
    assertFailureIncludes(failures, 'must not register Playwright route mocks');
  });
}

for (const routeMethod of ['abort', 'continue', 'fallback', 'fetch', 'fulfill']) {
  test(`guard rejects route.${routeMethod} fake provider responses`, () => {
    const failures = runFixture({
      [files.realProviderSpec]: externalRealProviderSpecWithInjection(`
        await route['${routeMethod}']();
      `),
    });

    assertFailureIncludes(failures, `route.${routeMethod}`);
    assertFailureIncludes(failures, 'must not fake provider responses with route handler calls');
  });
}

test('guard rejects page.setContent in the external spec', () => {
  const failures = runFixture({
    [files.realProviderSpec]: externalRealProviderSpecWithInjection(`
      await page[\`setContent\`]('<main data-testid="world-stage"></main>');
    `),
  });

  assertFailureIncludes(failures, 'page.setContent');
  assertFailureIncludes(failures, 'must not replace the frontend document');
});

test('guard rejects direct chronicle row creation with event cursor attributes', () => {
  const failures = runFixture({
    [files.realProviderSpec]: externalRealProviderSpecWithInjection(`
      await page.evaluate(() => {
        const row = document.createElement('article');
        row.setAttribute('data-event-cursor', '42');
        document.querySelector('.archive-chronicle')?.appendChild(row);
      });
    `),
  });

  assertFailureIncludes(failures, 'must not inject chronicle/live rows directly');
  assertFailureIncludes(failures, 'data-event-cursor');
});

test('guard rejects direct chronicle row creation through dataset event cursors', () => {
  const failures = runFixture({
    [files.realProviderSpec]: externalRealProviderSpecWithInjection(`
      await page.evaluate(() => {
        const row = document.createElement('article');
        row.dataset.eventCursor = '42';
        document.querySelector('.archive-chronicle')?.appendChild(row);
      });
    `),
  });

  assertFailureIncludes(failures, 'must not inject chronicle/live rows directly');
});

test('guard rejects innerHTML chronicle rows with event cursor attributes', () => {
  const failures = runFixture({
    [files.realProviderSpec]: externalRealProviderSpecWithInjection(`
      await page.evaluate(() => {
        const html = \`<article class="live-row" data-event-cursor="42"></article>\`;
        document.querySelector('.archive-chronicle').innerHTML = html;
      });
    `),
  });

  assertFailureIncludes(failures, 'must not inject chronicle/live rows directly');
  assertFailureIncludes(failures, 'innerHTML');
  assertFailureIncludes(failures, 'data-event-cursor');
});

test('guard ignores fake frontend provenance patterns hidden in comments or strings', () => {
  const failures = runFixture({
    [files.realProviderSpec]: externalRealProviderSpecWithInjection(`
      const fakeRoute = "page.route('**/api/**', route => route.fulfill())";
      const fakeDom = "document.createElement('div'); target.innerHTML = '<div data-event-cursor=\\"1\\"></div>'";
      // await context.route('**/api/**', route => route.abort());
      // await page.setContent('<main data-event-cursor="1"></main>');
      void fakeRoute;
      void fakeDom;
    `),
  });

  assert.deepEqual(failures, []);
});

test('guard passes deterministic dev and built raw metadata runtime checks', () => {
  assert.deepEqual(runFixture({
    [files.deterministicLiveSpec]: deterministicRawMetadataSpecFixture(deterministicLiveTitle),
    [files.deterministicBuiltSpec]: deterministicRawMetadataSpecFixture(deterministicBuiltTitle),
  }), []);
});

test('guard rejects deterministic raw metadata checks hidden in a preceding fake test', () => {
  const failures = runFixture({
    [files.deterministicLiveSpec]: `
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('guard-only fake', async ({ page, request }) => {
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });

      test('${deterministicLiveTitle}', async ({ page, request }) => {
        await page.goto('/');
        void request;
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: deterministic dev live smoke must fetch run metadata`);
  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: deterministic dev live smoke must build rawRunMetadataBannedCopy`);
  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: deterministic dev live smoke must call expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy) at least twice`);
});

test('guard rejects duplicate deterministic smoke callbacks', () => {
  const failures = runFixture({
    [files.deterministicBuiltSpec]: `
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('${deterministicBuiltTitle}', async ({ page, request }) => {
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });

      test('${deterministicBuiltTitle}', async ({ page, request }) => {
        await page.goto('/');
        void request;
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: deterministic built live smoke must contain exactly one Playwright test callback`);
});

test('guard rejects deterministic raw metadata helper omissions', () => {
  const failures = runFixture({
    [files.deterministicLiveSpec]: `
      const {
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('production app observes the real deterministic live API and SSE stream', async () => {
        await expectNoRawRunMetadataCopy(page, []);
      });
    `,
    [files.deterministicBuiltSpec]: `
      const {
        buildRawRunMetadataBannedCopy,
      } = require('./live-common-helpers');

      test('built frontend observes the real deterministic live API and SSE stream', async () => {
        buildRawRunMetadataBannedCopy({});
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: must import buildRawRunMetadataBannedCopy`);
  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: deterministic dev live smoke must build rawRunMetadataBannedCopy`);
  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: must import expectNoRawRunMetadataCopy`);
  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: deterministic built live smoke must call expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy) at least twice`);
});

test('guard rejects deterministic raw metadata helper imports hidden in strings', () => {
  const failures = runFixture({
    [files.deterministicLiveSpec]: `
      const fakeImport = "const { expectRunConstants, buildRawRunMetadataBannedCopy, expectNoRawRunMetadataCopy } = require('./live-common-helpers')";

      test('${deterministicLiveTitle}', async ({ page, request }) => {
        void fakeImport;
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: must import expectRunConstants from live-common-helpers.js`);
  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: must import buildRawRunMetadataBannedCopy from live-common-helpers.js`);
  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: must import expectNoRawRunMetadataCopy from live-common-helpers.js`);
});

test('guard rejects deterministic raw metadata calls hidden in comments or strings', () => {
  const failures = runFixture({
    [files.deterministicLiveSpec]: `
      const {
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('production app observes the real deterministic live API and SSE stream', async () => {
        // const banned = buildRawRunMetadataBannedCopy(runEnvelope.body);
        // await expectNoRawRunMetadataCopy(page, banned);
        const fakeBuild = "buildRawRunMetadataBannedCopy(runEnvelope.body)";
        const fakeExpect = "expectNoRawRunMetadataCopy(page, banned)";
        void fakeBuild;
        void fakeExpect;
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: deterministic dev live smoke must build rawRunMetadataBannedCopy`);
  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: deterministic dev live smoke must call expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy) at least twice`);
});

test('guard rejects deterministic raw metadata helpers hidden outside the test body', () => {
  const failures = runFixture({
    [files.deterministicLiveSpec]: `
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      async function unusedRawMetadataCheck() {
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = buildRawRunMetadataBannedCopy(runEnvelope.body);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      }

      test('production app observes the real deterministic live API and SSE stream', async () => {
        await fetch('/api/world');
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: deterministic dev live smoke must fetch run metadata`);
  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: deterministic dev live smoke must build rawRunMetadataBannedCopy`);
  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: deterministic dev live smoke must call expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy) at least twice`);
});

test('guard rejects deterministic raw metadata copy checks with hardcoded values', () => {
  const failures = runFixture({
    [files.deterministicLiveSpec]: `
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('production app observes the real deterministic live API and SSE stream', async () => {
        const runEnvelope = await expectRunConstants(request);
        buildRawRunMetadataBannedCopy(runEnvelope.body);
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        await expectNoRawRunMetadataCopy(page, ['private-run']);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: deterministic dev live smoke must build rawRunMetadataBannedCopy`);
  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: deterministic dev live smoke must call expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy) at least twice`);
  assertFailureIncludes(failures, 'deterministic live raw metadata guard call counts must match');
});

test('guard rejects deterministic raw metadata parity when only one final check remains', () => {
  const failures = runFixture({
    [files.deterministicBuiltSpec]: `
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('built frontend observes the real deterministic live API and SSE stream', async () => {
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: deterministic built live smoke must call expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy) at least twice`);
  assertFailureIncludes(failures, 'deterministic live raw metadata guard call counts must match');
});

test('guard rejects deterministic raw metadata let imports that can be rebound', () => {
  const failures = runFixture({
    [files.deterministicBuiltSpec]: `
      let {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      expectRunConstants = async () => ({ body: {} });
      buildRawRunMetadataBannedCopy = () => [];
      expectNoRawRunMetadataCopy = async () => {};

      test('built frontend observes the real deterministic live API and SSE stream', async () => {
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: must import expectRunConstants from live-common-helpers.js`);
  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: must import buildRawRunMetadataBannedCopy from live-common-helpers.js`);
  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: must import expectNoRawRunMetadataCopy from live-common-helpers.js`);
  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: must not shadow expectRunConstants`);
  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: must not shadow buildRawRunMetadataBannedCopy`);
  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: must not shadow expectNoRawRunMetadataCopy`);
});

test('guard rejects deterministic raw metadata checks in unreachable blocks', () => {
  const failures = runFixture({
    [files.deterministicLiveSpec]: `
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('production app observes the real deterministic live API and SSE stream', async ({ page, request }) => {
        if (false) {
          const runEnvelope = await expectRunConstants(request);
          const rawRunMetadataBannedCopy = buildRawRunMetadataBannedCopy(runEnvelope.body);
          await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
          await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        }
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: deterministic dev live smoke must fetch run metadata`);
  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: deterministic dev live smoke must build rawRunMetadataBannedCopy`);
  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: deterministic dev live smoke must call expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy) at least twice`);
});

test('guard rejects deterministic raw metadata checks in nested test-body functions', () => {
  const failures = runFixture({
    [files.deterministicBuiltSpec]: `
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('built frontend observes the real deterministic live API and SSE stream', async ({ page, request }) => {
        async function unusedRawMetadataCheck() {
          const runEnvelope = await expectRunConstants(request);
          const rawRunMetadataBannedCopy = buildRawRunMetadataBannedCopy(runEnvelope.body);
          await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
          await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        }
        void unusedRawMetadataCheck;
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: deterministic built live smoke must fetch run metadata`);
  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: deterministic built live smoke must build rawRunMetadataBannedCopy`);
  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: deterministic built live smoke must call expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy) at least twice`);
});

test('guard rejects deterministic raw metadata checks after top-level early exits', () => {
  const failures = runFixture({
    [files.deterministicBuiltSpec]: `
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('built frontend observes the real deterministic live API and SSE stream', async ({ page, request }) => {
        if (true) {
          return;
        }
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: deterministic built live smoke must not contain top-level return`);
});

test('guard rejects deterministic raw metadata checks in arrows after a callback reference', () => {
  const failures = runFixture({
    [files.deterministicLiveSpec]: `
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('production app observes the real deterministic live API and SSE stream', actualSmoke);
      const unusedRawMetadataCheck = async ({ page, request }) => {
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = buildRawRunMetadataBannedCopy(runEnvelope.body);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      };
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: could not parse deterministic dev live smoke Playwright test callback`);
  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: deterministic dev live smoke must fetch run metadata`);
});

test('guard rejects deterministic raw metadata provenance reassignment or mutation', () => {
  const failures = runFixture({
    [files.deterministicBuiltSpec]: `
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('built frontend observes the real deterministic live API and SSE stream', async ({ page, request }) => {
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        rawRunMetadataBannedCopy.fill('nonexistent-safe-value');
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: must not reassign or mutate rawRunMetadataBannedCopy`);
});

test('guard rejects deterministic raw metadata fake request shadows', () => {
  const failures = runFixture({
    [files.deterministicLiveSpec]: `
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('production app observes the real deterministic live API and SSE stream', async ({ page, request }) => {
        var request = { get: async () => ({ ok: true, json: async () => ({}) }) };
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: must not shadow Playwright request`);
});

test('guard rejects deterministic raw metadata aliased request fixtures with outer fakes', () => {
  const failures = runFixture({
    [files.deterministicLiveSpec]: `
      const request = { get: async () => ({ ok: true, json: async () => ({}) }) };
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('production app observes the real deterministic live API and SSE stream', async ({ page, request: realRequest }) => {
        void realRequest;
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: deterministic dev live smoke Playwright callback must receive unaliased page and request fixtures directly`);
});

test('guard rejects deterministic raw metadata Object.freeze shadows', () => {
  const failures = runFixture({
    [files.deterministicBuiltSpec]: `
      const Object = { freeze: () => ['nonexistent-safe-value'] };
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('built frontend observes the real deterministic live API and SSE stream', async ({ page, request }) => {
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: must not shadow or reassign Object.freeze`);
});

test('guard rejects deterministic raw metadata global Object.freeze reassignment', () => {
  const failures = runFixture({
    [files.deterministicLiveSpec]: `
      globalThis.Object.freeze = () => ['nonexistent-safe-value'];
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('production app observes the real deterministic live API and SSE stream', async ({ page, request }) => {
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: must not shadow or reassign Object.freeze`);
});

test('guard rejects deterministic raw metadata dynamic Object.freeze mutation APIs', () => {
  const failures = runFixture({
    [files.deterministicBuiltSpec]: `
      Reflect.set(Object, 'freeze', () => ['nonexistent-safe-value']);
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('built frontend observes the real deterministic live API and SSE stream', async ({ page, request }) => {
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: must not use dynamic mutation APIs`);
});

test('guard rejects deterministic raw metadata Playwright fixture reassignment', () => {
  const failures = runFixture({
    [files.deterministicBuiltSpec]: `
      const fakeRequest = { get: async () => ({ ok: true, json: async () => ({}) }) };
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('built frontend observes the real deterministic live API and SSE stream', async ({ page, request }) => {
        request = fakeRequest;
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: must not reassign Playwright request`);
});

test('guard rejects deterministic raw metadata Playwright fixture destructuring reassignment', () => {
  const failures = runFixture({
    [files.deterministicBuiltSpec]: `
      const fakeRequest = { get: async () => ({ ok: true, json: async () => ({}) }) };
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('built frontend observes the real deterministic live API and SSE stream', async ({ page, request }) => {
        ({ request } = { request: fakeRequest });
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: must not reassign Playwright request through destructuring`);
});

test('guard rejects deterministic raw metadata Playwright fixture array reassignment', () => {
  const failures = runFixture({
    [files.deterministicBuiltSpec]: `
      const fakeRequest = { get: async () => ({ ok: true, json: async () => ({}) }) };
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('built frontend observes the real deterministic live API and SSE stream', async ({ page, request }) => {
        [request] = [fakeRequest];
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: must not reassign Playwright request through destructuring`);
});

test('guard rejects deterministic raw metadata live-common helper export mutation', () => {
  const failures = runFixture({
    [files.deterministicLiveSpec]: `
      const liveCommon = require('./live-common-helpers');
      liveCommon.expectRunConstants = async () => ({ body: {} });
      liveCommon.buildRawRunMetadataBannedCopy = () => ['nonexistent-safe-value'];
      liveCommon.expectNoRawRunMetadataCopy = async () => {};
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('production app observes the real deterministic live API and SSE stream', async ({ page, request }) => {
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: must not mutate live-common-helpers.js exports`);
});

test('guard rejects deterministic raw metadata live-common dynamic export mutation APIs', () => {
  const failures = runFixture({
    [files.deterministicLiveSpec]: `
      const liveCommon = require('./live-common-helpers');
      Object.assign(liveCommon, {
        expectRunConstants: async () => ({ body: {} }),
        buildRawRunMetadataBannedCopy: () => ['nonexistent-safe-value'],
        expectNoRawRunMetadataCopy: async () => {},
      });
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('production app observes the real deterministic live API and SSE stream', async ({ page, request }) => {
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: must not use dynamic mutation APIs`);
});

test('guard rejects deterministic raw metadata Object alias mutation APIs', () => {
  const failures = runFixture({
    [files.deterministicBuiltSpec]: `
      const O = Object;
      O.defineProperty(Object, 'freeze', { value: () => ['nonexistent-safe-value'] });
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('built frontend observes the real deterministic live API and SSE stream', async ({ page, request }) => {
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: must not use dynamic mutation APIs`);
});

test('guard rejects deterministic raw metadata computed Object property mutation', () => {
  const failures = runFixture({
    [files.deterministicLiveSpec]: `
      Object['free' + 'ze'] = () => ['nonexistent-safe-value'];
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('production app observes the real deterministic live API and SSE stream', async ({ page, request }) => {
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: must not use dynamic mutation APIs`);
});

test('guard rejects deterministic raw metadata CommonJS cache helper mutation', () => {
  const failures = runFixture({
    [files.deterministicLiveSpec]: `
      require.cache[require.resolve('./live-common-helpers')].exports.expectRunConstants = async () => ({ body: {} });
      const {
        expectRunConstants,
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('production app observes the real deterministic live API and SSE stream', async ({ page, request }) => {
        const runEnvelope = await expectRunConstants(request);
        const rawRunMetadataBannedCopy = Object.freeze(
          buildRawRunMetadataBannedCopy(runEnvelope.body),
        );
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
        await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: must not use dynamic mutation APIs`);
});

test('guard rejects member or local definitions as deterministic raw metadata calls', () => {
  const failures = runFixture({
    [files.deterministicBuiltSpec]: `
      const {
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      const local = {
        buildRawRunMetadataBannedCopy() {},
        expectNoRawRunMetadataCopy() {},
      };

      test('built frontend observes the real deterministic live API and SSE stream', async () => {
        const banned = local.buildRawRunMetadataBannedCopy(runEnvelope.body);
        await local.expectNoRawRunMetadataCopy(page, banned);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: deterministic built live smoke must build rawRunMetadataBannedCopy`);
  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: deterministic built live smoke must call expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy) at least twice`);
});

test('guard rejects deterministic raw metadata direct shadows', () => {
  const failures = runFixture({
    [files.deterministicLiveSpec]: `
      const {
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('production app observes the real deterministic live API and SSE stream', async () => {
        const buildRawRunMetadataBannedCopy = () => [];
        function expectNoRawRunMetadataCopy() {}
        const banned = buildRawRunMetadataBannedCopy(runEnvelope.body);
        await expectNoRawRunMetadataCopy(page, banned);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: must not shadow buildRawRunMetadataBannedCopy`);
  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: must not shadow expectNoRawRunMetadataCopy`);
});

test('guard rejects deterministic raw metadata destructuring shadows', () => {
  const failures = runFixture({
    [files.deterministicBuiltSpec]: `
      const {
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      const local = {};
      test('built frontend observes the real deterministic live API and SSE stream', async () => {
        const {
          buildRawRunMetadataBannedCopy,
          expectNoRawRunMetadataCopy,
        } = local;
        const banned = buildRawRunMetadataBannedCopy(runEnvelope.body);
        await expectNoRawRunMetadataCopy(page, banned);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: must not shadow buildRawRunMetadataBannedCopy`);
  assertFailureIncludes(failures, `${files.deterministicBuiltSpec}: must not shadow expectNoRawRunMetadataCopy`);
});

test('guard rejects deterministic raw metadata parameter shadows', () => {
  const failures = runFixture({
    [files.deterministicLiveSpec]: `
      const {
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('production app observes the real deterministic live API and SSE stream', async ({
        buildRawRunMetadataBannedCopy,
        expectNoRawRunMetadataCopy,
      }) => {
        const banned = buildRawRunMetadataBannedCopy(runEnvelope.body);
        await expectNoRawRunMetadataCopy(page, banned);
      });
    `,
  });

  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: must not shadow buildRawRunMetadataBannedCopy`);
  assertFailureIncludes(failures, `${files.deterministicLiveSpec}: must not shadow expectNoRawRunMetadataCopy`);
});

test('guard rejects external spec omission of raw run metadata copy helper', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectNoBannedObserverCopy,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        await fetch('/api/run');
        await fetchWorldSnapshot();
      });
    `,
  });

  assertFailureIncludes(failures, 'must import expectNoRawRunMetadataCopy');
  assertFailureIncludes(failures, 'must call expectNoRawRunMetadataCopy');
});

test('guard rejects external spec omission of live event presentation helper', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        await fetch('/api/run');
        await fetchWorldSnapshot();
      });
    `,
  });

  assertFailureIncludes(failures, 'must import expectLiveEventPresentation');
  assertFailureIncludes(failures, 'must call expectLiveEventPresentation');
});

test('guard rejects external spec omission of renderer freshness helper', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectLiveEventPresentation,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
        formatLiveEventCursorCorrelationFailure,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        const presentationState = await expectLiveEventPresentation(page);
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        await fetch('/api/run');
        await fetchWorldSnapshot();
        void presentationState;
        void formatLiveEventCursorCorrelationFailure;
      });
    `,
  });

  assertFailureIncludes(failures, 'must import expectLiveRendererFreshness');
  assertFailureIncludes(failures, 'must call expectLiveRendererFreshness(page, presentationState)');
});

test('guard rejects external renderer freshness calls with fake provenance', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectLiveEventPresentation,
        expectLiveRendererFreshness,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
        formatLiveEventCursorCorrelationFailure,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        const presentationState = await expectLiveEventPresentation(page);
        await expectLiveRendererFreshness(page, { chronicleRows: [{ cursor: 1 }] });
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        await fetch('/api/run');
        await fetchWorldSnapshot();
        void presentationState;
        void formatLiveEventCursorCorrelationFailure;
      });
    `,
  });

  assertFailureIncludes(failures, 'must call expectLiveRendererFreshness(page, presentationState)');
});

test('guard rejects external renderer freshness checks hidden outside the smoke callback', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectLiveEventPresentation,
        expectLiveRendererFreshness,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
        formatLiveEventCursorCorrelationFailure,
      } = require('./live-common-helpers');

      async function guardOnly(page, presentationState) {
        await expectLiveRendererFreshness(page, presentationState);
      }

      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        const presentationState = await expectLiveEventPresentation(page);
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        await fetch('/api/run');
        await fetchWorldSnapshot();
        void presentationState;
        void formatLiveEventCursorCorrelationFailure;
      });
    `,
  });

  assertFailureIncludes(failures, 'must call expectLiveRendererFreshness(page, presentationState)');
});

test('guard rejects external spec omission of retained surface helper', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectLiveEventPresentation,
        expectLiveRendererFreshness,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
        formatLiveEventCursorCorrelationFailure,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        const presentationState = await expectLiveEventPresentation(page);
        await expectLiveRendererFreshness(page, presentationState);
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        await fetch('/api/run');
        await fetchWorldSnapshot();
        void presentationState;
        void formatLiveEventCursorCorrelationFailure;
      });
    `,
  });

  assertFailureIncludes(failures, 'must import expectLiveRetainedSurfacePresentation');
  assertFailureIncludes(failures, 'must call expectLiveRetainedSurfacePresentation(page)');
});

test('guard rejects external retained surface calls with fake page provenance', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectLiveEventPresentation,
        expectLiveRendererFreshness,
        expectLiveRetainedSurfacePresentation,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
        formatLiveEventCursorCorrelationFailure,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        const presentationState = await expectLiveEventPresentation(page);
        await expectLiveRendererFreshness(page, presentationState);
        await expectLiveRetainedSurfacePresentation({ evaluate: async () => ({}) });
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        await fetch('/api/run');
        await fetchWorldSnapshot();
        void presentationState;
        void formatLiveEventCursorCorrelationFailure;
      });
    `,
  });

  assertFailureIncludes(failures, 'must call expectLiveRetainedSurfacePresentation(page)');
});

test('guard rejects shadowed external retained surface helper', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectLiveEventPresentation,
        expectLiveRendererFreshness,
        expectLiveRetainedSurfacePresentation,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
        formatLiveEventCursorCorrelationFailure,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        const expectLiveRetainedSurfacePresentation = async () => {};
        expectNoBannedObserverCopy();
        const presentationState = await expectLiveEventPresentation(page);
        await expectLiveRendererFreshness(page, presentationState);
        await expectLiveRetainedSurfacePresentation(page);
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        await fetch('/api/run');
        await fetchWorldSnapshot();
        void formatLiveEventCursorCorrelationFailure;
      });
    `,
  });

  assertFailureIncludes(failures, 'must not shadow expectLiveRetainedSurfacePresentation');
});

test('guard rejects shadowed external renderer freshness helper', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectLiveEventPresentation,
        expectLiveRendererFreshness,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
        formatLiveEventCursorCorrelationFailure,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        const expectLiveRendererFreshness = async () => {};
        expectNoBannedObserverCopy();
        const presentationState = await expectLiveEventPresentation(page);
        await expectLiveRendererFreshness(page, presentationState);
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        await fetch('/api/run');
        await fetchWorldSnapshot();
        void formatLiveEventCursorCorrelationFailure;
      });
    `,
  });

  assertFailureIncludes(failures, 'must not shadow expectLiveRendererFreshness');
});

test('guard rejects common helper omission of retained surface export', () => {
  const failures = runFixture({
    [files.commonHelpers]: `
      async function expectLiveEventPresentation() {}
      async function expectLiveRendererFreshness() {}
      async function expectNoRawRunMetadataCopy() {}
      function formatLiveEventCursorCorrelationFailure() {}
      module.exports = {
        expectLiveEventPresentation,
        expectLiveRendererFreshness,
        expectNoRawRunMetadataCopy,
        formatLiveEventCursorCorrelationFailure,
      };
    `,
  });

  assertFailureIncludes(failures, `${files.commonHelpers}: must export expectLiveRetainedSurfacePresentation`);
});

test('guard rejects common helper omission of renderer freshness export', () => {
  const failures = runFixture({
    [files.commonHelpers]: `
      async function expectLiveEventPresentation() {}
      async function expectNoRawRunMetadataCopy() {}
      function formatLiveEventCursorCorrelationFailure() {}
      module.exports = {
        expectLiveEventPresentation,
        expectNoRawRunMetadataCopy,
        formatLiveEventCursorCorrelationFailure,
      };
    `,
  });

  assertFailureIncludes(failures, `${files.commonHelpers}: must export expectLiveRendererFreshness`);
});

test('guard rejects external spec omission of event cursor correlation formatter', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectLiveEventPresentation,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        await expectLiveEventPresentation(page);
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        expect(true, formatLiveEventCursorCorrelationFailure({
          apiEventCursors: [1],
          presentedChronicleCursors: [1],
        })).toBe(true);
        await fetch('/api/run');
        await fetchWorldSnapshot();
      });
    `,
  });

  assertFailureIncludes(failures, 'must import formatLiveEventCursorCorrelationFailure');
});

test('guard rejects external spec omission of event cursor correlation assertion', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectLiveEventPresentation,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
        formatLiveEventCursorCorrelationFailure,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        await expectLiveEventPresentation(page);
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        await fetch('/api/run');
        await fetchWorldSnapshot();
        void formatLiveEventCursorCorrelationFailure;
      });
    `,
  });

  assertFailureIncludes(failures, 'must pass formatLiveEventCursorCorrelationFailure');
});

test('guard rejects inert external event cursor correlation assertion', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectLiveEventPresentation,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
        formatLiveEventCursorCorrelationFailure,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        await expectLiveEventPresentation(page);
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        expect(true, formatLiveEventCursorCorrelationFailure({
          apiEventCursors: [1],
          presentedChronicleCursors: [1],
        })).toBe(true);
        await fetch('/api/run');
        await fetchWorldSnapshot();
      });
    `,
  });

  assertFailureIncludes(failures, 'must pass formatLiveEventCursorCorrelationFailure');
});

test('guard rejects hardcoded external event cursor correlation provenance', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectLiveEventPresentation,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
        formatLiveEventCursorCorrelationFailure,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        await expectLiveEventPresentation(page);
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        const apiEventCursors = [1];
        const apiEventCursorSet = new Set(apiEventCursors);
        const presentedChronicleCursors = [1];
        expect(
          presentedChronicleCursors.some((cursor) => apiEventCursorSet.has(cursor)),
          formatLiveEventCursorCorrelationFailure({
            apiEventCursors,
            presentedChronicleCursors,
          }),
        ).toBe(true);
        await fetch('/api/run');
        await fetchWorldSnapshot();
      });
    `,
  });

  assertFailureIncludes(failures, 'must fetch eventsEnvelope from /api/events?cursor=0');
  assertFailureIncludes(failures, 'must derive apiEventCursors from eventsEnvelope.body.events');
  assertFailureIncludes(failures, 'must derive presentedChronicleCursors from presentationState.chronicleRows');
});

test('guard rejects fake external presentation state provenance', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectLiveEventPresentation,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
        formatLiveEventCursorCorrelationFailure,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        await expectLiveEventPresentation(page);
        const presentationState = { chronicleRows: [{ cursor: 1 }] };
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        const eventsEnvelope = await page.evaluate(async () => {
          const response = await fetch('/api/events?cursor=0', {
            headers: { Accept: 'application/json' },
          });
          return {
            ok: response.ok,
            status: response.status,
            body: await response.json(),
          };
        });
        const apiEventCursors = eventsEnvelope.body.events
          .map((entry) => entry.cursor)
          .filter((cursor) => Number.isFinite(cursor) && cursor > 0);
        const apiEventCursorSet = new Set(apiEventCursors);
        const presentedChronicleCursors = presentationState.chronicleRows
          .map((row) => row.cursor)
          .filter((cursor) => Number.isFinite(cursor) && cursor > 0);
        expect(
          presentedChronicleCursors.some((cursor) => apiEventCursorSet.has(cursor)),
          formatLiveEventCursorCorrelationFailure({
            apiEventCursors,
            presentedChronicleCursors,
          }),
        ).toBe(true);
        await fetch('/api/run');
        await fetchWorldSnapshot();
      });
    `,
  });

  assertFailureIncludes(failures, 'must assign presentationState from await expectLiveEventPresentation(page)');
});

test('guard rejects external events envelope with unused fetch and hardcoded body', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectLiveEventPresentation,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
        formatLiveEventCursorCorrelationFailure,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        const presentationState = await expectLiveEventPresentation(page);
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        const eventsEnvelope = await page.evaluate(async () => {
          await fetch('/api/events?cursor=0', {
            headers: { Accept: 'application/json' },
          });
          return {
            ok: true,
            status: 200,
            body: { events: [{ cursor: 1 }] },
          };
        });
        const apiEventCursors = eventsEnvelope.body.events
          .map((entry) => entry.cursor)
          .filter((cursor) => Number.isFinite(cursor) && cursor > 0);
        const apiEventCursorSet = new Set(apiEventCursors);
        const presentedChronicleCursors = presentationState.chronicleRows
          .map((row) => row.cursor)
          .filter((cursor) => Number.isFinite(cursor) && cursor > 0);
        expect(
          presentedChronicleCursors.some((cursor) => apiEventCursorSet.has(cursor)),
          formatLiveEventCursorCorrelationFailure({
            apiEventCursors,
            presentedChronicleCursors,
          }),
        ).toBe(true);
        await fetch('/api/run');
        await fetchWorldSnapshot();
      });
    `,
  });

  assertFailureIncludes(failures, 'must fetch eventsEnvelope from /api/events?cursor=0');
});

test('guard rejects external presentation state mutation before cursor correlation', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectLiveEventPresentation,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
        formatLiveEventCursorCorrelationFailure,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        const presentationState = await expectLiveEventPresentation(page);
        presentationState.chronicleRows = [{ cursor: 1 }];
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        const eventsEnvelope = await page.evaluate(async () => {
          const response = await fetch('/api/events?cursor=0', {
            headers: { Accept: 'application/json' },
          });
          return {
            ok: response.ok,
            status: response.status,
            body: await response.json(),
          };
        });
        const apiEventCursors = eventsEnvelope.body.events
          .map((entry) => entry.cursor)
          .filter((cursor) => Number.isFinite(cursor) && cursor > 0);
        const apiEventCursorSet = new Set(apiEventCursors);
        const presentedChronicleCursors = presentationState.chronicleRows
          .map((row) => row.cursor)
          .filter((cursor) => Number.isFinite(cursor) && cursor > 0);
        expect(
          presentedChronicleCursors.some((cursor) => apiEventCursorSet.has(cursor)),
          formatLiveEventCursorCorrelationFailure({
            apiEventCursors,
            presentedChronicleCursors,
          }),
        ).toBe(true);
        await fetch('/api/run');
        await fetchWorldSnapshot();
      });
    `,
  });

  assertFailureIncludes(failures, 'must not reassign or mutate live event cursor correlation provenance');
});

test('guard rejects shadowed fetch inside external events envelope callback', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectLiveEventPresentation,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
        formatLiveEventCursorCorrelationFailure,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        const presentationState = await expectLiveEventPresentation(page);
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        const eventsEnvelope = await page.evaluate(async () => {
          const fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ events: [{ cursor: 1 }] }),
          });
          const response = await fetch('/api/events?cursor=0', {
            headers: { Accept: 'application/json' },
          });
          return {
            ok: response.ok,
            status: response.status,
            body: await response.json(),
          };
        });
        const apiEventCursors = eventsEnvelope.body.events
          .map((entry) => entry.cursor)
          .filter((cursor) => Number.isFinite(cursor) && cursor > 0);
        const apiEventCursorSet = new Set(apiEventCursors);
        const presentedChronicleCursors = presentationState.chronicleRows
          .map((row) => row.cursor)
          .filter((cursor) => Number.isFinite(cursor) && cursor > 0);
        expect(
          presentedChronicleCursors.some((cursor) => apiEventCursorSet.has(cursor)),
          formatLiveEventCursorCorrelationFailure({
            apiEventCursors,
            presentedChronicleCursors,
          }),
        ).toBe(true);
        await fetch('/api/run');
        await fetchWorldSnapshot();
      });
    `,
  });

  assertFailureIncludes(failures, 'must fetch eventsEnvelope from /api/events?cursor=0');
});

test('guard rejects external runtime checks hidden outside the smoke callback', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectLiveEventPresentation,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
        formatLiveEventCursorCorrelationFailure,
      } = require('./live-common-helpers');

      async function guardOnly(page) {
        await expectLiveEventPresentation(page);
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        expect(true, formatLiveEventCursorCorrelationFailure({
          apiEventCursors: [1],
          presentedChronicleCursors: [1],
        })).toBe(true);
      }

      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        await fetch('/api/run');
        await fetchWorldSnapshot();
      });
    `,
  });

  assertFailureIncludes(failures, 'must call expectNoRawRunMetadataCopy');
  assertFailureIncludes(failures, 'must call expectLiveEventPresentation');
  assertFailureIncludes(failures, 'must pass formatLiveEventCursorCorrelationFailure');
});

test('guard rejects unawaited external runtime checks', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectLiveEventPresentation,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
        formatLiveEventCursorCorrelationFailure,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        expectLiveEventPresentation(page);
        expectNoRawRunMetadataCopy(page, ['private-run']);
        expect(true, formatLiveEventCursorCorrelationFailure({
          apiEventCursors: [1],
          presentedChronicleCursors: [1],
        })).toBe(true);
        await fetch('/api/run');
        await fetchWorldSnapshot();
      });
    `,
  });

  assertFailureIncludes(failures, 'must call expectNoRawRunMetadataCopy');
  assertFailureIncludes(failures, 'must call expectLiveEventPresentation');
});

test('guard rejects external smoke control transfer before runtime checks', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectLiveEventPresentation,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
        formatLiveEventCursorCorrelationFailure,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        return;
        await expectLiveEventPresentation(page);
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        expect(true, formatLiveEventCursorCorrelationFailure({
          apiEventCursors: [1],
          presentedChronicleCursors: [1],
        })).toBe(true);
        await fetch('/api/run');
        await fetchWorldSnapshot();
      });
    `,
  });

  assertFailureIncludes(failures, 'must not contain top-level return');
});

test('guard rejects external helper imports hidden in strings', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const fakeImport = "const { fetchWorldSnapshot, expectLiveEventPresentation, expectNoBannedObserverCopy, expectNoRawRunMetadataCopy, formatLiveEventCursorCorrelationFailure } = require('./live-common-helpers')";

      test('${externalRealProviderTitle}', async () => {
        void fakeImport;
        expectNoBannedObserverCopy();
        await expectLiveEventPresentation(page);
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        expect(true, formatLiveEventCursorCorrelationFailure({
          apiEventCursors: [1],
          presentedChronicleCursors: [1],
        })).toBe(true);
        await fetch('/api/run');
        await fetchWorldSnapshot();
      });
    `,
  });

  assertFailureIncludes(failures, 'must import generic helpers from live-common-helpers.js');
  assertFailureIncludes(failures, 'must import expectNoRawRunMetadataCopy');
  assertFailureIncludes(failures, 'must import expectLiveEventPresentation');
  assertFailureIncludes(failures, 'must import formatLiveEventCursorCorrelationFailure');
});

test('guard rejects external spec omission of raw run metadata copy call', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        await fetch('/api/run');
        await fetchWorldSnapshot();
      });
    `,
  });

  assertFailureIncludes(failures, 'must call expectNoRawRunMetadataCopy');
});

test('guard rejects raw run metadata copy call hidden in comments or strings', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        // await expectNoRawRunMetadataCopy(page, ['private-run']);
        const fake = "expectNoRawRunMetadataCopy(page, ['private-run'])";
        expectNoBannedObserverCopy();
        await fetch('/api/run');
        await fetchWorldSnapshot();
        void fake;
      });
    `,
  });

  assertFailureIncludes(failures, 'must call expectNoRawRunMetadataCopy');
});

test('guard rejects member or local definitions as raw run metadata copy calls', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      const local = { expectNoRawRunMetadataCopy() {} };
      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        local.expectNoRawRunMetadataCopy(page, ['private-run']);
        await fetch('/api/run');
        await fetchWorldSnapshot();
      });
    `,
  });

  assertFailureIncludes(failures, 'must call expectNoRawRunMetadataCopy');
});

test('guard rejects local raw run metadata copy function declarations', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectNoBannedObserverCopy,
      } = require('./live-common-helpers');

      function expectNoRawRunMetadataCopy() {}
      test('${externalRealProviderTitle}', async () => {
        expectNoBannedObserverCopy();
        await fetch('/api/run');
        await fetchWorldSnapshot();
      });
    `,
  });

  assertFailureIncludes(failures, 'must import expectNoRawRunMetadataCopy');
  assertFailureIncludes(failures, 'must call expectNoRawRunMetadataCopy');
});

test('guard rejects local shadowing of raw run metadata copy helper', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async () => {
        const expectNoRawRunMetadataCopy = () => {};
        expectNoBannedObserverCopy();
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        await fetch('/api/run');
        await fetchWorldSnapshot();
      });
    `,
  });

  assertFailureIncludes(failures, 'must not shadow expectNoRawRunMetadataCopy');
});

test('guard rejects destructuring shadow of raw run metadata copy helper', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      const local = {};
      test('${externalRealProviderTitle}', async () => {
        const { expectNoRawRunMetadataCopy } = local;
        expectNoBannedObserverCopy();
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        await fetch('/api/run');
        await fetchWorldSnapshot();
      });
    `,
  });

  assertFailureIncludes(failures, 'must not shadow expectNoRawRunMetadataCopy');
});

test('guard rejects parameter shadow of raw run metadata copy helper', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const {
        fetchWorldSnapshot,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
      } = require('./live-common-helpers');

      test('${externalRealProviderTitle}', async ({ expectNoRawRunMetadataCopy }) => {
        expectNoBannedObserverCopy();
        await expectNoRawRunMetadataCopy(page, ['private-run']);
        await fetch('/api/run');
        await fetchWorldSnapshot();
      });
    `,
  });

  assertFailureIncludes(failures, 'must not shadow expectNoRawRunMetadataCopy');
});

test('guard rejects common helper omission of raw run metadata copy helper', () => {
  const failures = runFixture({
    [files.commonHelpers]: `
      async function fetchWorldSnapshot() {}
      async function expectNoBannedObserverCopy() {}
      module.exports = {
        fetchWorldSnapshot,
        expectNoBannedObserverCopy,
      };
    `,
  });

  assertFailureIncludes(failures, 'must export expectNoRawRunMetadataCopy');
});

test('guard rejects common helper omission of live event presentation helper', () => {
  const failures = runFixture({
    [files.commonHelpers]: `
      async function fetchWorldSnapshot() {}
      async function expectNoBannedObserverCopy() {}
      async function expectNoRawRunMetadataCopy() {}
      module.exports = {
        fetchWorldSnapshot,
        expectNoBannedObserverCopy,
        expectNoRawRunMetadataCopy,
      };
    `,
  });

  assertFailureIncludes(failures, 'must export expectLiveEventPresentation');
});

test('guard rejects common helper omission of event cursor correlation formatter', () => {
  const failures = runFixture({
    [files.commonHelpers]: `
      async function fetchWorldSnapshot() {}
      async function expectNoBannedObserverCopy() {}
      async function expectLiveEventPresentation() {}
      async function expectNoRawRunMetadataCopy() {}
      module.exports = {
        fetchWorldSnapshot,
        expectNoBannedObserverCopy,
        expectLiveEventPresentation,
        expectNoRawRunMetadataCopy,
      };
    `,
  });

  assertFailureIncludes(failures, 'must export formatLiveEventCursorCorrelationFailure');
});

test('guard rejects common helper raw run metadata helper when it is not exported', () => {
  const failures = runFixture({
    [files.commonHelpers]: `
      async function fetchWorldSnapshot() {}
      async function expectNoBannedObserverCopy() {}
      async function expectNoRawRunMetadataCopy() {}
      module.exports = {
        fetchWorldSnapshot,
        expectNoBannedObserverCopy,
      };
    `,
  });

  assertFailureIncludes(failures, 'must export expectNoRawRunMetadataCopy');
});

test('guard rejects common helper raw run metadata export hidden in strings', () => {
  const failures = runFixture({
    [files.commonHelpers]: `
      async function fetchWorldSnapshot() {}
      async function expectNoBannedObserverCopy() {}
      async function expectLiveEventPresentation() {}
      async function expectNoRawRunMetadataCopy() {}
      const fakeExport = "module.exports = { fetchWorldSnapshot, expectLiveEventPresentation, expectNoBannedObserverCopy, expectNoRawRunMetadataCopy }";
      module.exports = {
        fetchWorldSnapshot,
        expectNoBannedObserverCopy,
        expectLiveEventPresentation,
        fakeExport,
      };
    `,
  });

  assertFailureIncludes(failures, 'must export expectNoRawRunMetadataCopy');
});

test('guard rejects deterministic helper imports in the external spec', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      import { triggerMechanicsBurst } from './live-mechanics-helpers.js';
      const { fetchWorldSnapshot } = require('./live-common-helpers');
    `,
  });

  assertFailureIncludes(failures, 'must not import deterministic mechanics helpers');
  assertFailureIncludes(failures, 'triggerMechanicsBurst');
});

test('guard rejects retired deterministic helper imports in the external spec', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const { fetchWorldSnapshot } = require('./live-common-helpers');
      const legacy = await import('./live-smoke-helpers');
      void legacy;
    `,
  });

  assertFailureIncludes(failures, 'must not import deterministic mechanics helpers');
  assertFailureIncludes(failures, 'live-smoke-helpers');
});

test('guard rejects split mechanics route fragments in external and common helpers', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const { fetchWorldSnapshot } = require('./live-common-helpers');
      const forbidden = ['/api/test', '/mechanics/run'].join('');
      void forbidden;
    `,
    [files.commonHelpers]: `
      const route = ['/api/test', '/mechanics/run'].join('');
      module.exports = { route };
    `,
  });

  assertFailureIncludes(failures, 'external real-provider smoke must not contain');
  assertFailureIncludes(failures, 'generic external-smoke helpers must not contain');
});

test('guard rejects mechanics count constants in external and common helper sources', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const { fetchWorldSnapshot } = require('./live-common-helpers');
      console.log(MECHANICS_EVENT_MIN_COUNTS);
      console.log(LIVE_RUN_EVENT_TYPES);
    `,
    [files.commonHelpers]: `
      const STRUCTURAL_MECHANICS_REASON_MIN_COUNTS = {};
      module.exports = { STRUCTURAL_MECHANICS_REASON_MIN_COUNTS };
    `,
  });

  assertFailureIncludes(failures, 'MECHANICS_EVENT_MIN_COUNTS');
  assertFailureIncludes(failures, 'LIVE_RUN_EVENT_TYPES');
  assertFailureIncludes(failures, 'STRUCTURAL_MECHANICS_REASON_MIN_COUNTS');
});

test('guard rejects deterministic theft proof helpers in external and common helper sources', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const { fetchWorldSnapshot } = require('./live-common-helpers');
      await expectMechanicsTheftReplayProof(events, snapshots);
    `,
    [files.commonHelpers]: `
      function expectThievedJoeHomeAftermath() {}
      module.exports = { expectThievedJoeHomeAftermath };
    `,
  });

  assertFailureIncludes(failures, 'expectMechanicsTheftReplayProof');
  assertFailureIncludes(failures, 'expectThievedJoeHomeAftermath');
});

test('guard rejects renderer summary diagnostics in external and common helper sources', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const { fetchWorldSnapshot } = require('./live-common-helpers');
      await expectMechanicsRendererSummaryDiagnostics(page, burst);
      validateMechanicsRendererSummaryDiagnostics(diagnostics, 42);
      console.log(
        LIVE_RENDERER_SUMMARY_KIND_POOL,
        LIVE_RENDERER_RAW_SUMMARY_FIELDS,
        LIVE_RENDERER_SUMMARY_TUPLE_FIELDS,
      );
    `,
    [files.commonHelpers]: `
      const LIVE_RENDERER_REQUIRED_TAIL_SUMMARIES = Object.freeze([]);
      const LIVE_RENDERER_SUMMARY_TUPLE_ARRAY_FIELDS = Object.freeze([]);
      const LIVE_RENDERER_MOTION_MODE_SUMMARY_KINDS = Object.freeze([]);
      function validateMechanicsRendererSummaryDiagnostics() {}
      module.exports = {
        LIVE_RENDERER_REQUIRED_TAIL_SUMMARIES,
        LIVE_RENDERER_SUMMARY_TUPLE_ARRAY_FIELDS,
        LIVE_RENDERER_MOTION_MODE_SUMMARY_KINDS,
        validateMechanicsRendererSummaryDiagnostics,
      };
    `,
  });

  assertFailureIncludes(failures, 'expectMechanicsRendererSummaryDiagnostics');
  assertFailureIncludes(failures, 'validateMechanicsRendererSummaryDiagnostics');
  for (const reference of rendererSummaryDiagnosticReferences) {
    assertFailureIncludes(failures, reference);
  }
});

test('guard rejects renderer summary diagnostics module imports in external and common helpers', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const { fetchWorldSnapshot } = require('./live-common-helpers');
      const {
        validateMechanicsRendererSummaryDiagnostics,
      } = require('./live-renderer-summary-diagnostics');
      void fetchWorldSnapshot;
      void validateMechanicsRendererSummaryDiagnostics;
    `,
    [files.commonHelpers]: `
      import('./live-renderer-summary-diagnostics.js');
      async function fetchWorldSnapshot() {}
      module.exports = { fetchWorldSnapshot };
    `,
  });

  assertFailureIncludes(failures, 'must not import deterministic mechanics helpers');
  assertFailureIncludes(failures, 'live-renderer-summary-diagnostics');
  assertFailureIncludes(failures, 'validateMechanicsRendererSummaryDiagnostics');
  assertFailureIncludes(failures, 'generic external-smoke helpers must not import');
});

test('guard rejects renderer summary diagnostics export-list drift', () => {
  const extraFailures = runFixture({
    [files.rendererSummaryDiagnostics]: rendererSummaryDiagnosticsFixture([
      ...rendererSummaryDiagnosticReferences,
      'LIVE_RENDERER_NEW_DIAGNOSTIC_EXPORT',
    ]),
  });

  assertFailureIncludes(extraFailures, 'rendererSummaryDiagnosticReferences');
  assertFailureIncludes(extraFailures, 'LIVE_RENDERER_NEW_DIAGNOSTIC_EXPORT');

  const missingFailures = runFixture({
    [files.rendererSummaryDiagnostics]: rendererSummaryDiagnosticsFixture(
      rendererSummaryDiagnosticReferences.filter((reference) => (
        reference !== 'LIVE_RENDERER_RAW_SUMMARY_FIELDS'
      )),
    ),
  });

  assertFailureIncludes(missingFailures, 'rendererSummaryDiagnosticReferences');
  assertFailureIncludes(missingFailures, 'LIVE_RENDERER_RAW_SUMMARY_FIELDS');

  const swappedFailures = runFixture({
    [files.rendererSummaryDiagnostics]: rendererSummaryDiagnosticsFixture(
      rendererSummaryDiagnosticReferences.map((reference) => (
        reference === 'LIVE_RENDERER_RAW_SUMMARY_FIELDS'
          ? 'LIVE_RENDERER_RENAMED_SUMMARY_FIELDS'
          : reference
      )),
    ),
  });

  assertFailureIncludes(swappedFailures, 'rendererSummaryDiagnosticReferences');
  assertFailureIncludes(swappedFailures, 'LIVE_RENDERER_RENAMED_SUMMARY_FIELDS');
  assertFailureIncludes(swappedFailures, 'LIVE_RENDERER_RAW_SUMMARY_FIELDS');
});

test('guard accepts renderer summary diagnostics CommonJS named exports', () => {
  assert.deepEqual(runFixture({
    [files.rendererSummaryDiagnostics]: rendererSummaryDiagnosticsNamedExportFixture(
      rendererSummaryDiagnosticReferences,
    ),
  }), []);
});

test('guard rejects renderer summary diagnostics named-export drift', () => {
  const extraFailures = runFixture({
    [files.rendererSummaryDiagnostics]: rendererSummaryDiagnosticsNamedExportFixture([
      ...rendererSummaryDiagnosticReferences,
      'LIVE_RENDERER_NAMED_EXPORT_DRIFT',
    ]),
  });

  assertFailureIncludes(extraFailures, 'rendererSummaryDiagnosticReferences');
  assertFailureIncludes(extraFailures, 'LIVE_RENDERER_NAMED_EXPORT_DRIFT');

  const missingFailures = runFixture({
    [files.rendererSummaryDiagnostics]: rendererSummaryDiagnosticsNamedExportFixture(
      rendererSummaryDiagnosticReferences.filter((reference) => (
        reference !== 'LIVE_RENDERER_SUMMARY_TUPLE_FIELDS'
      )),
    ),
  });

  assertFailureIncludes(missingFailures, 'rendererSummaryDiagnosticReferences');
  assertFailureIncludes(missingFailures, 'LIVE_RENDERER_SUMMARY_TUPLE_FIELDS');
});

test('guard rejects future renderer summary constants in external and common helper sources', () => {
  const failures = runFixture({
    [files.realProviderSpec]: `
      const { fetchWorldSnapshot } = require('./live-common-helpers');
      console.log(LIVE_RENDERER_FUTURE_DIAGNOSTIC_KIND);
      void fetchWorldSnapshot;
    `,
    [files.commonHelpers]: `
      const LIVE_RENDERER_FUTURE_COMMON_FIELD = 'forbidden';
      module.exports = { LIVE_RENDERER_FUTURE_COMMON_FIELD };
    `,
  });

  assertFailureIncludes(failures, 'LIVE_RENDERER_FUTURE_DIAGNOSTIC_KIND');
  assertFailureIncludes(failures, 'LIVE_RENDERER_FUTURE_COMMON_FIELD');
});

test('guard leaves deterministic mechanics helper summary wrapper allowed', () => {
  const readPaths = [];
  const readFile = (relativePath) => {
    readPaths.push(relativePath);
    if (relativePath === 'tests/frontend-live/live-mechanics-helpers.js') {
      return `
        async function expectMechanicsRendererSummaryDiagnostics() {}
        module.exports = {
          expectMechanicsRendererSummaryDiagnostics,
        };
      `;
    }
    return fixtureReader()(relativePath);
  };

  assert.deepEqual(runGuard({ readFile }), []);
  assert(!readPaths.includes('tests/frontend-live/live-mechanics-helpers.js'));
});

test('guard rejects external spec drift into deterministic configs', () => {
  const failures = runFixture({
    [files.deterministicLiveConfig]: `
      module.exports = {
        testMatch: /live-real-provider\\.spec\\.js/,
      };
    `,
  });

  assertFailureIncludes(failures, 'testMatch must stay narrowed to live-real-api.spec.js');
  assertFailureIncludes(failures, 'must not reference live-real-provider.spec.js');
});

test('guard rejects webServer on external real-provider config', () => {
  const failures = runFixture({
    [files.realLiveConfig]: `
      module.exports = {
        testMatch: /live-real-provider\\.spec\\.js/,
        webServer: { command: 'npm run dev:frontend' },
      };
    `,
  });

  assertFailureIncludes(failures, 'must not define a webServer property');
});

test('guard rejects external config drift into deterministic specs', () => {
  const failures = runFixture({
    [files.realLiveConfig]: `
      module.exports = {
        testMatch: /live-real-api\\.spec\\.js/,
      };
    `,
  });

  assertFailureIncludes(failures, 'testMatch must stay narrowed to live-real-provider.spec.js');
});

function runFixture(overrides) {
  return runGuard({ readFile: fixtureReader(overrides) });
}

function fixtureReader(overrides = {}) {
  const sources = { ...goodSources, ...overrides };
  return (relativePath) => {
    if (!(relativePath in sources)) {
      throw new Error(`missing fixture for ${relativePath}`);
    }
    return sources[relativePath];
  };
}

function rendererSummaryDiagnosticsFixture(references) {
  const declarations = references
    .map((reference) => `const ${reference} = Object.freeze([]);`)
    .join('\n');
  const exports = references
    .map((reference) => `  ${reference},`)
    .join('\n');
  return `
    ${declarations}
    function validateMechanicsRendererSummaryDiagnostics() {}
    module.exports = {
${exports}
      validateMechanicsRendererSummaryDiagnostics,
    };
  `;
}

function rendererSummaryDiagnosticsNamedExportFixture(references) {
  const exports = references
    .map((reference, index) => {
      const target = index % 2 === 0 ? 'exports' : 'module.exports';
      return `${target}.${reference} = Object.freeze([]);`;
    })
    .join('\n');
  return `
    ${exports}
    module.exports.validateMechanicsRendererSummaryDiagnostics = function () {};
  `;
}

function deterministicRawMetadataSpecFixture(title) {
  return `
    const { test, expect } = require('@playwright/test');

    const {
      expectRunConstants,
      buildRawRunMetadataBannedCopy,
      expectNoRawRunMetadataCopy,
    } = require('./live-common-helpers');

    test('${title}', async ({ page, request }) => {
      page.on('request', (request) => {
        void request.url();
      });
      const runEnvelope = await expectRunConstants(request);
      const rawRunMetadataBannedCopy = Object.freeze(
        buildRawRunMetadataBannedCopy(runEnvelope.body),
      );
      await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
      expect(rawRunMetadataBannedCopy.length).toBeGreaterThan(0);
    });
  `;
}

function externalRealProviderSpecWithInjection(injectedSource) {
  return goodSources[files.realProviderSpec].replace(
    '      void presentationState;',
    `${injectedSource}\n      void presentationState;`,
  );
}

function assertFailureIncludes(failures, expected) {
  assert(
    failures.some((failure) => failure.includes(expected)),
    `Expected one failure to include ${expected}; got:\n${failures.join('\n')}`,
  );
}
