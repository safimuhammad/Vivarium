/**
 * FOLLOW: the camera goes to the being the viewer picked, and STAYS with them.
 *
 * Two owner reports from one live run, 2026-08-27:
 *
 * 1. *"the follow doesnt work well it stays on auto"* — picking a being from the HUD's FOLLOW
 *    dropdown did nothing at all and the control snapped straight back to `Automatic`. The
 *    pursuit vetoed itself whenever the camera was already the viewer's (`free`), which it is
 *    after any pan and after every Atlas island click, because choosing a PLACE requests Free by
 *    design. The veto was silent: no request reached the renderer and no notice was posted.
 * 2. Automatic framing previously moved between regions on every beat. The current
 *    Quiet Observatory policy holds routine activity for 30 seconds, then permits
 *    regional visits; important events have an earlier cut and returns have a cooldown.
 *
 * Both are live-wiring defects, and the shell's own unit suite mocks the stage away, so it was
 * green throughout. These run the real shell, the real stage and the real production Canvas
 * renderer, and read the camera out of the renderer's own diagnostics rather than inferring it
 * from the chrome.
 *
 * Beats are real. C12 is the cross-region chronicle: it opens with Joe and Mae in Warm Springs
 * and Dick and Allen in Nirvana, and then plays a run of beats with nothing in Warm Springs at
 * all — a viewer watching Warm Springs is exactly the case both reports come from.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { getChronicleManifest } from "../../frontend/src/presentation/fixtures/chronicleCatalog";
import { installProductionChronicleFixture } from "./fixtures/production-chronicle-fixture";

const C12_FILE = "tests/frontend-app/fixtures/chronicles/data/C12-cross-region-causal-life-story.json";
/**
 * C12's opening run of beats, none of them in Warm Springs.
 *
 * Cursors 1-4 are Nirvana's (a greeting, a resource change, a home going up, a hearth used) and
 * cursor 5 is the placeless one -- a mating proposal, which belongs to no region at all. A run of
 * beats with nothing for a Warm Springs viewer in any of them is the whole case.
 */
const ELSEWHERE_FIRST_CURSOR = 1;
const ELSEWHERE_LAST_CURSOR = 5;

/**
 * How many of those beats must be PERFORMED before the run counts as having happened.
 *
 * A floor rather than an exact cursor because the presentation paces its own moments on a wall
 * clock -- how far it gets inside the budget is its business, and pinning it would be asserting
 * the beat director's tempo instead of the camera's behaviour. What matters is that the loop
 * cannot pass on nothing: this is the guard against a beat driver that silently delivers no
 * beats at all, which is exactly the trap the first draft of this file fell into.
 */
const MINIMUM_BEATS_PERFORMED = 2;
const STAGE_SELECTOR = ".presentation-world-stage";
const OUTPUT_DIRECTORY = path.resolve(
  process.env.VIVARIUM_FOLLOW_EVIDENCE_DIR ?? "artifacts/follow-subject",
);

/** The slice of the stage's debug probe this file reads. */
interface StageProbe {
  readonly visibleRegionId: string | null;
  readonly loadingRegionId: string | null;
  readonly camera: Readonly<{
    mode: "story" | "follow" | "free";
    followEntityId: string | null;
  }>;
  readonly worldNavigation?: Readonly<{ scope: string | null; regionId: string | null }>;
}

test.describe("follow subject", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__vivariumEnableProductionDiagnosticsForTest = true;
    });
  });

  test("follows the being the viewer picked, and holds them across every beat elsewhere", async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
    const errors = collectErrors(page);
    const fixture = await bootChronicle(page);

    // The precondition that used to kill every pick: the viewer already holds the camera. An
    // Atlas island click is the ordinary way to get here -- it means "I chose a place", so it
    // deliberately requests Free -- and a plain drag across the canvas does the same.
    await observeRegionFromAtlas(page, "warm_springs");
    await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-camera-mode", "free");

    await followSubject(page, "Joe");

    // What the viewer sees.
    const control = page.locator(".observer-hud__follow");
    await expect(control).toHaveAttribute("data-follow", "following");
    await expect(followSelect(page)).toHaveValue("wanderer_001");
    expect(await followSelect(page).locator("option:checked").textContent()).toBe("Joe");
    await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-camera-mode", "follow");
    // A pursuit that ends says so. Nothing ended here, so nothing may be said.
    await expect(page.locator(".observer-hud__follow-notice")).toHaveCount(0);

    // What the camera is actually doing, from the renderer itself.
    expect(await readProbe(page)).toMatchObject({
      visibleRegionId: "warm_springs",
      camera: { mode: "follow", followEntityId: "agent:wanderer_001" },
    });

    await page.screenshot({
      path: path.join(OUTPUT_DIRECTORY, "follow-latched.png"),
      animations: "disabled",
    });

    // Five real beats, not one of them in this region. None may take the camera off the being
    // the viewer chose -- that reversion is what read as "it stays on auto".
    const reached = await playBeatsElsewhere(page, fixture, (probe, cursor) => {
      expect(probe, `a beat at cursor ${cursor} took the camera`).toMatchObject({
        visibleRegionId: "warm_springs",
        camera: { mode: "follow", followEntityId: "agent:wanderer_001" },
      });
    });
    expect(reached, "the beats must actually have played")
      .toBeGreaterThanOrEqual(MINIMUM_BEATS_PERFORMED);

    await expect(followSelect(page)).toHaveValue("wanderer_001");
    await expect(control).toHaveAttribute("data-follow", "following");
    await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-camera-mode", "follow");
    await expect(page.locator(".observer-hud__follow-notice")).toHaveCount(0);

    await page.screenshot({
      path: path.join(OUTPUT_DIRECTORY, "follow-held-after-beats.png"),
      animations: "disabled",
    });
    expect(errors).toEqual([]);
    await fixture.dispose();
  });

  test("carries the camera across a border for a being the viewer chose", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    const fixture = await bootChronicle(page);
    await observeRegionFromAtlas(page, "warm_springs");

    // Dick is in Nirvana. Following is an explicit viewer choice, so it -- unlike the director --
    // may leave the region on screen: the pursuit observes his region, waits for him to appear,
    // and only then latches.
    await followSubject(page, "Dick");
    await page.waitForFunction(({ selector }) => {
      const stage = document.querySelector(selector);
      const probe = stage === null
        ? null
        : window.__vivariumProductionDiagnosticsForTest?.snapshot(stage) as StageProbe | null;
      return probe?.camera.followEntityId === "agent:wanderer_003"
        && probe?.visibleRegionId === "nirvana"
        && probe?.loadingRegionId === null;
    }, { selector: STAGE_SELECTOR }, { timeout: 30_000 });

    await expect(followSelect(page)).toHaveValue("wanderer_003");
    await expect(page.locator(".observer-hud__follow")).toHaveAttribute("data-follow", "following");
    await expect(page.locator(".observer-hud__follow-notice")).toHaveCount(0);
    expect(errors).toEqual([]);
    await fixture.dispose();
  });

  test("Auto holds the viewed region for routine activity, then may visit a later event", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    const fixture = await bootChronicle(page);
    await observeRegionFromAtlas(page, "warm_springs");
    await page.getByLabel("Vivarium world").focus();
    const returnedToAutoAt = Date.now();
    await page.keyboard.press("s");
    await settle(page);

    // Only routine speech/resource events: cursor 3 is an important home event,
    // which may legitimately cut after eight seconds under the current policy.
    await fixture.dispatchRange(1, 2);
    let reached = 0;
    while (Date.now() - returnedToAutoAt < 29_000) {
      expect(await readProbe(page)).toMatchObject({
        visibleRegionId: "warm_springs",
        camera: { mode: "story" },
      });
      reached = Math.max(reached, Number(
        await page.locator(".vivarium-2d-app").getAttribute("data-presented-cursor") ?? 0,
      ));
      await expect(page.locator(".presentation-world-stage__failure")).toHaveCount(0);
      await settle(page);
    }
    expect(reached, "routine events really played while Auto held the view").toBe(2);

    // Auto is allowed to visit another region after its ordinary dwell; it is
    // no longer permanently locked to the region the viewer last selected.
    await page.waitForTimeout(Math.max(0, 30_100 - (Date.now() - returnedToAutoAt)));
    await fixture.dispatchRange(3, 3);
    await expect.poll(async () => (await readProbe(page)).visibleRegionId, {
      timeout: 20_000,
    }).toBe("nirvana");

    await observeRegionFromAtlas(page, "warm_springs");
    expect((await readProbe(page)).visibleRegionId).toBe("warm_springs");
    expect(errors).toEqual([]);
    await fixture.dispose();
  });
});

function followSelect(page: Page) {
  return page.getByLabel("Camera subject");
}

/**
 * Uncaught page exceptions only.
 *
 * Console errors are NOT collected here: the chronicle fixture rejects unlisted routes with a
 * 404 on purpose (that closed-world audit is the point of `ProductionRouteHandler`), so a
 * console-error assertion would be asserting the fixture's own design.
 */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/**
 * Plays C12's opening beats through, checking one invariant the whole way.
 *
 * Dispatched as a range and then WATCHED to its end rather than stepped cursor by cursor: the
 * presentation paces moments on its own clock, so the cursor a beat lands on is the
 * presentation's business, not this test's. Returning the cursor it reached is what keeps this
 * honest -- a beat loop that silently delivered nothing would read as a pass.
 */
async function playBeatsElsewhere(
  page: Page,
  fixture: Readonly<{ dispatchRange(first: number, last: number): Promise<void> }>,
  invariant: (probe: StageProbe, cursor: string | null) => void,
): Promise<number> {
  await fixture.dispatchRange(ELSEWHERE_FIRST_CURSOR, ELSEWHERE_LAST_CURSOR);
  const app = page.locator(".vivarium-2d-app");
  const failure = page.locator(".presentation-world-stage__failure");
  let cursor = await app.getAttribute("data-presented-cursor");
  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline) {
    // Holding the region means the story's region and the mounted one come apart, and the graph
    // has to be told which one it is drawing. Told the wrong one it builds the story region's
    // scene against the mounted region's terrain cache, and the viewer gets "The committed
    // region art will be refreshed." over a half-drawn map (`graphObserverRegionOverride`).
    await expect(failure, `the world faulted at cursor ${cursor}`).toHaveCount(0);
    invariant(await readProbe(page), cursor);
    if (cursor === String(ELSEWHERE_LAST_CURSOR)) break;
    await settle(page);
    cursor = await app.getAttribute("data-presented-cursor");
  }
  return Number(cursor ?? 0);
}

/** Boots the production observer over C12, parked at cursor 0 with the stage ready. */
async function bootChronicle(page: Page) {
  const fixture = await installProductionChronicleFixture(
    page,
    getChronicleManifest("C12"),
    C12_FILE,
  );
  await page.waitForFunction((selector) => (
    document.querySelector<HTMLElement>(selector)?.dataset.ready === "true"
  ), STAGE_SELECTOR, { timeout: 30_000 });
  return fixture;
}

/**
 * Chooses a place the way a viewer does: the World drawer's Atlas, then out of the drawer again.
 *
 * This is the path that leaves the camera in `free` -- an island click MEANS "I chose a place",
 * so it claims the camera on purpose (`observeRegion` in the shell).
 */
async function observeRegionFromAtlas(page: Page, regionId: string): Promise<void> {
  await page.getByRole("button", { name: "World", exact: true }).click();
  await page.locator(`.living-atlas-2d__observe[data-region-key="${regionId}"]`).click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(({ selector, expected }) => {
    const stage = document.querySelector(selector);
    const probe = stage === null
      ? null
      : window.__vivariumProductionDiagnosticsForTest?.snapshot(stage) as StageProbe | null;
    return probe?.visibleRegionId === expected && probe?.loadingRegionId === null;
  }, { selector: STAGE_SELECTOR, expected: regionId }, { timeout: 30_000 });
  await settle(page);
}

/** Picks a being by their public name, exactly as the HUD offers them. */
async function followSubject(page: Page, name: string): Promise<void> {
  await followSelect(page).selectOption({ label: name });
  await settle(page);
}

/** Lets the renderer commit whatever the last act asked of it. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let frame = 0; frame < 30; frame += 1) {
      await new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame(null)));
    }
  });
}

async function readProbe(page: Page): Promise<StageProbe> {
  const probe = await page.evaluate((selector) => {
    const stage = document.querySelector(selector);
    return stage === null
      ? null
      : (window.__vivariumProductionDiagnosticsForTest?.snapshot(stage) ?? null);
  }, STAGE_SELECTOR);
  expect(probe, "the production stage debug probe must be installed").not.toBeNull();
  return probe as StageProbe;
}
