import { expect, test } from "@playwright/test";

const ROUTE = "/?renderer=2d";
const STAGE = ".presentation-world-stage";

// `nirvana-scenery-data.mjs` is a genuine ES module (also consumed directly
// by plain-Node fixtures under `fixtures/nirvana-scenery-server*.mjs`), but
// this spec file is transpiled to CommonJS by Playwright's default
// transform (no `"type": "module"` at the repo root) — a static import of
// an `.mjs` file from CJS-transpiled output fails at load time
// ("Unexpected token 'export'"). A cached dynamic `import()` sidesteps that
// CJS/ESM interop gap without requiring a repo-wide module-type change.
type NirvanaSceneryFixture = typeof import("./fixtures/nirvana-scenery-data.mjs");
let nirvanaSceneryFixturePromise: Promise<NirvanaSceneryFixture> | null = null;
function nirvanaSceneryFixture(): Promise<NirvanaSceneryFixture> {
  nirvanaSceneryFixturePromise ??= import("./fixtures/nirvana-scenery-data.mjs");
  return nirvanaSceneryFixturePromise;
}

test("exact Nirvana scenery is ingested by the real zero-actor production route", async ({ page }) => {
  const browserErrors: string[] = [];
  const atlasResponses = new Set<string>();

  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (/\/(?:terrain|landmarks)\.png$/.test(new URL(response.url()).pathname)) {
      atlasResponses.add(new URL(response.url()).pathname);
    }
  });

  await page.addInitScript(() => {
    window.__vivariumEnableProductionDiagnosticsForTest = true;

    class IdleEventSource {
      readonly url: string;
      readonly readyState = 1;

      constructor(url: string | URL) {
        this.url = String(url);
      }

      addEventListener(): void {
        // The scenery gate intentionally has no live events.
      }

      removeEventListener(): void {
        // The fixture owns no listeners.
      }

      close(): void {
        // The fixture is scoped to this page.
      }
    }

    window.EventSource = IdleEventSource as unknown as typeof EventSource;
  });

  await installSceneryApi(page);
  await page.goto(ROUTE);

  await expect(page.locator(".vivarium-2d-app")).toHaveCount(1);
  await expect(page.locator(STAGE)).toHaveCount(1);
  await expect(page.locator(`${STAGE} > canvas[aria-label="Vivarium world"]`)).toHaveCount(1);
  await expect(page.locator(STAGE)).toHaveAttribute("data-ready", "true");
  await expect(page.locator(".nirvana-production, .nirvana-production-stage")).toHaveCount(0);

  const proof = await page.evaluate(async ({ stageSelector }) => {
    const stage = document.querySelector(stageSelector);
    if (stage === null) throw new Error("production scenery proof has no stage");
    const diagnostics = window.__vivariumProductionDiagnosticsForTest?.snapshot(stage) as any;
    if (diagnostics === null || diagnostics === undefined) {
      throw new Error("production scenery diagnostics were not installed");
    }

    const assetModule = await import(
      "/src/renderer2d/production/nirvana/NirvanaAssetProfile.ts"
    );

    return {
      location: `${window.location.pathname}${window.location.search}`,
      stages: document.querySelectorAll(stageSelector).length,
      canvases: document.querySelectorAll(`${stageSelector} canvas`).length,
      visibleRegionId: diagnostics.visibleRegionId,
      loadingRegionId: diagnostics.loadingRegionId,
      staticCacheRegions: diagnostics.staticCacheRegions,
      mountedStaticCache: diagnostics.mountedStaticCache,
      visibleRecipe: diagnostics.visibleRecipe,
      staticArtFallbacks: diagnostics.staticArtFallbacks,
      graphRegion: diagnostics.graph.activeRegion,
      actors: diagnostics.graph.activeActors,
      homes: diagnostics.graph.activeHomes,
      effects: diagnostics.graph.activeEffects,
      requiredAtlasPaths: assetModule.NIRVANA_ATLAS_PROFILE.descriptors
        .map((descriptor: { url: { href: string } }) => new URL(descriptor.url.href).pathname)
        .sort(),
    };
  }, {
    stageSelector: STAGE,
  });

  expect(proof).toMatchObject({
    location: ROUTE,
    stages: 1,
    canvases: 1,
    visibleRegionId: "nirvana",
    loadingRegionId: null,
    staticCacheRegions: ["nirvana"],
    staticArtFallbacks: 0,
    mountedStaticCache: {
      regionId: "nirvana",
      staticCacheIdentity: expect.any(String),
    },
    visibleRecipe: {
      regionId: "nirvana",
      grid: { columns: 96, rows: 96 },
      identityHash: expect.any(String),
      presentationProfile: {
        kind: "nirvana-v2",
        atlasProfileVersion: 2,
        staticSceneHash: expect.any(String),
      },
    },
    actors: 0,
    homes: 0,
    effects: 0,
  });
  expect(proof.visibleRecipe.presentationProfile.staticSceneHash).toMatch(/^[0-9a-f]{8}$/);
  expect(proof.mountedStaticCache.staticCacheIdentity).toBe([
    proof.visibleRecipe.presentationProfile.kind,
    proof.visibleRecipe.presentationProfile.atlasProfileVersion,
    proof.visibleRecipe.identityHash,
    proof.visibleRecipe.presentationProfile.staticSceneHash,
  ].join(":"));
  expect(proof.graphRegion).toMatchObject({
    id: "nirvana",
    recipeIdentityHash: proof.visibleRecipe.identityHash,
  });
  expect([...atlasResponses].sort()).toEqual(expect.arrayContaining(proof.requiredAtlasPaths));
  expect(browserErrors).toEqual([]);
});

test("historical Nirvana pressure expands the real production route as one toroidal scene under a bounded camera", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.addInitScript(() => {
    window.__vivariumEnableProductionDiagnosticsForTest = true;

    class IdleEventSource {
      readonly url: string;
      readonly readyState = 1;

      constructor(url: string | URL) {
        this.url = String(url);
      }

      addEventListener(): void {
        // The deterministic expansion gate intentionally has no live events.
      }

      removeEventListener(): void {
        // The fixture owns no listeners.
      }

      close(): void {
        // The fixture is scoped to this page.
      }
    }

    window.EventSource = IdleEventSource as unknown as typeof EventSource;
  });

  const { NIRVANA_SCENERY_WORLD } = await nirvanaSceneryFixture();
  const expandedWorld = {
    ...NIRVANA_SCENERY_WORLD,
    region_pressure: NIRVANA_SCENERY_WORLD.regions.map(({ name }) => ({
      region: name,
      population_high_water: name === "nirvana" ? 225 : 0,
      built_footprint_high_water: 0,
    })),
  };
  await installSceneryApi(page, expandedWorld);
  await page.goto(ROUTE);
  await expect(page.locator(STAGE)).toHaveAttribute("data-ready", "true");
  if (process.env.VIVARIUM_CAPTURE_NIRVANA_EXPANDED === "1") {
    await page.screenshot({
      path: "tmp/nirvana-expanded-production.png",
      animations: "disabled",
    });
  }

  const proof = await page.evaluate((stageSelector) => {
    const stage = document.querySelector(stageSelector);
    if (stage === null) throw new Error("expanded Nirvana proof has no stage");
    return window.__vivariumProductionDiagnosticsForTest?.snapshot(stage);
  }, STAGE) as any;

  expect(proof).toMatchObject({
    visibleRegionId: "nirvana",
    loadingRegionId: null,
    staticArtFallbacks: 0,
    visibleRecipe: {
      regionId: "nirvana",
      grid: { columns: 96, rows: 128 },
      presentationProfile: {
        kind: "nirvana-v2",
        atlasProfileVersion: 2,
      },
    },
    mountedStaticCache: {
      regionId: "nirvana",
      staticCacheIdentity: expect.any(String),
    },
    camera: {
      // The observer camera is BOUNDED and stays bounded. This assertion was left behind
      // by the camera-wrap retirement (Z2) — all three production `setWorldBounds` calls
      // pass the literal "bounded", so it has been failing since then; `tests/frontend-app`
      // is not in the standard gate set, so nobody saw it. Torus physics phase 2 makes
      // BEINGS wrap and deliberately leaves the camera alone, so the honest value is
      // "bounded". The region's own descriptor topology is still "toroidal" and still
      // drives hit-testing and the beings-only seam continuation pass.
      topology: "bounded",
      worldBounds: {
        x: 0,
        y: 0,
        width: 96 * 32,
        height: 128 * 32,
      },
    },
  });
  expect(proof.mountedStaticCache.staticCacheIdentity).toBe([
    proof.visibleRecipe.presentationProfile.kind,
    proof.visibleRecipe.presentationProfile.atlasProfileVersion,
    proof.visibleRecipe.identityHash,
    proof.visibleRecipe.presentationProfile.staticSceneHash,
  ].join(":"));
  expect(browserErrors).toEqual([]);
});

async function installSceneryApi(
  page: import("@playwright/test").Page,
  world?: unknown,
): Promise<void> {
  const { NIRVANA_SCENERY_RUN, NIRVANA_SCENERY_CHECKPOINT, NIRVANA_SCENERY_WORLD } =
    await nirvanaSceneryFixture();
  const resolvedWorld = world ?? NIRVANA_SCENERY_WORLD;
  await page.route("**/api/run", (route) => route.fulfill({ json: NIRVANA_SCENERY_RUN }));
  await page.route("**/api/world", (route) => route.fulfill({ json: resolvedWorld }));
  await page.route("**/api/events?*", (route) => {
    const cursor = Number(new URL(route.request().url()).searchParams.get("cursor") ?? 0);
    return route.fulfill({
      json: {
        schema: 1,
        cursor,
        oldest_cursor: 0,
        next_cursor: cursor,
        events: [],
        overflow: false,
        snapshot_required: false,
      },
    });
  });
  await page.route("**/api/replay/manifest", (route) => route.fulfill({
    json: {
      schema: 1,
      run_id: NIRVANA_SCENERY_RUN.run_id,
      events: { count: 0, first_cursor: null, last_cursor: null },
      checkpoints: {
        count: 1,
        first_line: 1,
        last_line: 1,
        first_event_cursor: 0,
        last_event_cursor: 0,
      },
      bootstrap: { event_after: 0, event_limit: 512 },
    },
  }));
  await page.route("**/api/replay/checkpoints/latest", (route) => route.fulfill({
    json: {
      schema: 1,
      run_id: NIRVANA_SCENERY_RUN.run_id,
      line: 1,
      checkpoint: NIRVANA_SCENERY_CHECKPOINT,
    },
  }));
  await page.route("**/api/replay/checkpoints?*", (route) => {
    const before = Number(new URL(route.request().url()).searchParams.get("before") ?? 0);
    return route.fulfill({
      json: {
        schema: 1,
        run_id: NIRVANA_SCENERY_RUN.run_id,
        before,
        next_before: before > 1 ? 1 : null,
        has_more: false,
        checkpoints: before > 1
          ? [{ line: 1, checkpoint: NIRVANA_SCENERY_CHECKPOINT }]
          : [],
      },
    });
  });
  await page.route("**/api/replay/events?*", (route) => {
    const after = Number(new URL(route.request().url()).searchParams.get("after") ?? 0);
    return route.fulfill({
      json: {
        schema: 1,
        run_id: NIRVANA_SCENERY_RUN.run_id,
        after,
        next_after: after,
        has_more: false,
        events: [],
      },
    });
  });
}
