import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { parseChronicleManifest } from "../../frontend/src/presentation/fixtures/chronicleCatalog";
import {
  installLivingAtlasFixture,
  livingAtlasWorld,
} from "./living-atlas-fixture";
import { installProductionChronicleFixture } from "./fixtures/production-chronicle-fixture";
import {
  driveProductionCaptureClockUntilSettled,
  installTypedProductionCaptureEntry,
} from "./fixtures/typed-production-capture-entry";

const ACTIVE_MOBILE_CHRONICLE_PATH = path.resolve(
  "tests/frontend-app/fixtures/chronicles/data/C01-movement-local-path.json",
);
const ACTIVE_MOBILE_CHRONICLE = parseChronicleManifest(JSON.parse(
  readFileSync(ACTIVE_MOBILE_CHRONICLE_PATH, "utf8"),
));

const VIEWPORTS = [
  { name: "wide", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "short", width: 1280, height: 600 },
  { name: "mobile", width: 390, height: 844 },
] as const;

test("semantic mirror exposes each visible subject's name, status, position, and current action", async ({ page }) => {
  await installProductionFixture(page, { width: 1440, height: 900 }, semanticSubjectWorld());
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByLabel("Vivarium world"))
    .toHaveAttribute("aria-describedby", "world-keyboard-help");
  // The region switcher (`LivingAtlas2D`) only mounts inside the World
  // drawer, which starts closed (`INITIAL_OBSERVER_OVERLAY_STATE`) for
  // every viewport — open it first, exactly like the other panel-scoped
  // tests below open "Chronicle" before probing its content.
  await page.getByRole("button", { name: "World", exact: true }).click();
  const nirvana = page.getByRole("button", { name: /^Observe Nirvana (?!East|West)/ });
  await nirvana.focus();
  await page.keyboard.press("Enter");

  const mirror = page.getByRole("region", { name: "World subjects" });
  await expect(mirror).toBeVisible();
  for (const expected of [
    /Nirvana.*Status:.*Position:.*Current action:/i,
    /Aster.*Status: Alive.*Position: Nirvana.*Current action:/i,
    /Dusk.*Status: Dead.*Position: Nirvana.*Current action:/i,
    /Aster's home.*Status: Standing.*Position: Nirvana.*Current action:/i,
    /Dusk's former home.*Status: Ruin.*Position: Nirvana.*Current action:/i,
  ]) {
    await expect(mirror.getByRole("button", { name: expected })).toBeVisible();
  }
  await expect(mirror).toContainText("No active action");
  const publicSurface = await page.locator("body").innerText();
  const serializedSurface = await page.locator("html").evaluate((node) => node.outerHTML);
  for (const rawId of ["agent_healthy", "home_001", "home_old"]) {
    expect(publicSurface).not.toContain(rawId);
    expect(serializedSurface).not.toContain(rawId);
  }
  expect(await mirror.locator("button").evaluateAll((nodes) => nodes.map((node) => node.textContent))).toHaveLength(5);
});

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} production observer has no clipping and keeps one usable surface`, async ({ page }) => {
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    await installProductionFixture(page, viewport);
    await page.getByRole("button", { name: "Chronicle" }).click();

    const audit = await page.evaluate(async ({ mobile }) => {
      const visibleControls = Array.from(document.querySelectorAll<HTMLElement>(
        'button, select, input, textarea, [role="button"]',
      )).filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
      const undersized44 = visibleControls.flatMap((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width < 44 || rect.height < 44
          ? [{ name: node.getAttribute("aria-label") ?? node.textContent?.trim(), width: rect.width, height: rect.height }]
          : [];
      });
      const advisory48 = visibleControls.filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width < 48 || rect.height < 48;
      }).length;
      const surface = document.querySelector<HTMLElement>(".observer-primary-surface");
      const drawer = document.querySelector<HTMLElement>(".observer-drawer");
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Vivarium world"]');
      const drawerRect = drawer?.getBoundingClientRect() ?? null;
      const debug = await import("/src/renderer2d/production/debug.ts");
      const stage = document.querySelector(".presentation-world-stage");
      const cameraSafeHeight = stage === null
        ? 0
        : (debug.getProductionStageDebugProbe(stage)?.snapshot().camera.safeFrame.height ?? 0);
      return {
        overflowX: document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth,
        overflowY: document.scrollingElement!.scrollHeight - document.scrollingElement!.clientHeight,
        undersized44,
        advisory48,
        primarySurfaces: document.querySelectorAll(".observer-primary-surface").length,
        drawerOverflowY: drawer === null ? null : getComputedStyle(drawer.querySelector(".observer-drawer__scroll")!).overflowY,
        drawerRole: surface?.getAttribute("role") ?? "complementary",
        drawerModal: surface?.getAttribute("aria-modal"),
        drawerHeight: drawerRect?.height ?? 0,
        canvasHeight: canvas?.getBoundingClientRect().height ?? 0,
        cameraSafeHeight,
      };
    }, { mobile: viewport.width <= 760 });

    expect(audit.overflowX).toBeLessThanOrEqual(1);
    expect(audit.overflowY).toBeLessThanOrEqual(1);
    expect(audit.undersized44).toEqual([]);
    expect(audit.primarySurfaces).toBe(1);
    expect(audit.drawerOverflowY).toMatch(/auto|scroll/);
    expect(audit.canvasHeight).toBeGreaterThanOrEqual(288);
    if (viewport.width <= 760) {
      expect(audit.drawerRole).toBe("dialog");
      expect(audit.drawerModal).toBe("true");
      expect(audit.cameraSafeHeight).toBeGreaterThanOrEqual(288);
      await page.keyboard.press("Shift+Tab");
      await expect(page.getByRole("button", { name: "Close Chronicle" })).toBeFocused();
    } else {
      expect(audit.drawerRole).toBe("complementary");
      expect(audit.drawerModal).not.toBe("true");
    }
    await page.getByRole("button", { name: "Close Chronicle" }).click();
    for (const panel of ["World", "Selection", "Archive"] as const) {
      const opener = page.getByRole("button", { name: panel, exact: true });
      await opener.click();
      await expect(page.getByRole("heading", { name: panel, exact: true })).toBeFocused();
      const panelLayout = await page.evaluate(() => ({
        overflowX: document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth,
        overflowY: document.scrollingElement!.scrollHeight - document.scrollingElement!.clientHeight,
        internalOverflow: (() => {
          const scrollSurface = document.querySelector<HTMLElement>(".observer-drawer__scroll");
          return scrollSurface === null ? null : getComputedStyle(scrollSurface).overflowY;
        })(),
      }));
      expect(panelLayout.overflowX).toBeLessThanOrEqual(1);
      expect(panelLayout.overflowY).toBeLessThanOrEqual(1);
      if (panelLayout.internalOverflow !== null) {
        expect(panelLayout.internalOverflow).toMatch(/auto|scroll/);
      }
      await page.getByRole("button", { name: `Close ${panel}` }).click();
      await expect(opener).toBeFocused();
    }
    expect(browserErrors).toEqual([]);
    test.info().annotations.push({ type: "48px advisory", description: String(audit.advisory48) });
  });
}

test("mobile atlas and three- or four-trigger observer strips stay disjoint and own their hit targets", async ({ browser }) => {
  test.setTimeout(60_000);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 390, height: 600 },
  ]) {
    const page = await browser.newPage({ viewport });
    await page.addInitScript(() => {
      window.__vivariumEnableProductionCaptureClockForTest = true;
    });
    await installTypedProductionCaptureEntry(page);
    const fixture = await installProductionChronicleFixture(
      page,
      ACTIVE_MOBILE_CHRONICLE,
      ACTIVE_MOBILE_CHRONICLE_PATH,
    );
    try {
      const viewShownMoment = page.locator("[data-story-now]")
        .getByRole("button", { name: /^View shown moment / });
      await expect(viewShownMoment).toHaveCount(0);
      assertMobileObserverChrome(
        await auditMobileObserverChrome(page),
        3,
        `${viewport.width}x${viewport.height} terminal`,
      );

      await driveProductionCaptureClockUntilSettled(
        page,
        fixture.dispatchRange(1, ACTIVE_MOBILE_CHRONICLE.expectedFinalCursor),
        { label: "activate C01 mobile Chronicle" },
      );
      await expect(viewShownMoment).toBeVisible();
      assertMobileObserverChrome(
        await auditMobileObserverChrome(page),
        4,
        `${viewport.width}x${viewport.height} active`,
      );
    } finally {
      await fixture.dispose();
      await page.close();
    }
  }
});

test("keyboard observer controls preserve focus and never command a being", async ({ page }) => {
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (!["GET"].includes(request.method())) mutations.push(`${request.method()} ${request.url()}`);
  });
  await installProductionFixture(page, { width: 1024, height: 768 }, semanticSubjectWorld());
  const canvas = page.getByLabel("Vivarium world");
  await canvas.focus();
  await page.keyboard.press("v");
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-camera-mode", "free");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
  await page.keyboard.press("]");
  await page.keyboard.press("-");
  await page.keyboard.press("[");
  await page.keyboard.press("Home");
  await page.keyboard.press("End");
  await expect(canvas).toBeFocused();
  // The region switcher (`LivingAtlas2D`) only mounts inside the World
  // drawer, which starts closed for every viewport — open it (the canvas
  // shortcuts above never needed it open; only inspecting its DOM does).
  await page.getByRole("button", { name: "World", exact: true }).click();
  await expect(page.locator('.living-atlas-2d__observe[aria-pressed="true"]')).toHaveCount(1);

  const nirvana = page.getByRole("button", { name: /^Observe Nirvana (?!East|West)/ });
  await nirvana.focus();
  await page.keyboard.press("Enter");
  await expect(nirvana).toHaveAttribute("aria-pressed", "true");
  // Close the World drawer — the two primary surfaces are mutually
  // exclusive in state, but the World drawer's still-visible DOM
  // otherwise intercepts the Chronicle trigger's click.
  await page.keyboard.press("Escape");

  const chronicle = page.getByRole("button", { name: "Chronicle" });
  await chronicle.click();
  await expect(page.getByRole("heading", { name: "Chronicle" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(chronicle).toBeFocused();

  const subject = page.getByRole("region", { name: "World subjects" })
    .getByRole("button", { name: /^Aster Status:/ });
  await subject.focus();
  await page.keyboard.press("Enter");
  await expect(subject).toHaveAttribute("aria-pressed", "true");
  await canvas.focus();
  await page.keyboard.press("f");
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-camera-mode", "follow");
  await page.keyboard.press("s");
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-camera-mode", "story");
  await page.keyboard.press("v");
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-camera-mode", "free");
  await page.keyboard.press("m");
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-camera-mode", "story");
  expect(mutations).toEqual([]);
});

test("production observer remounts cleanly after visiting the Living Atlas", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await installProductionFixture(page, { width: 1024, height: 768 });
  const productionCanvas = page.locator('canvas[aria-label="Vivarium world"]');
  await expect(productionCanvas).toHaveCount(1);

  await changeRendererRoute(page, "/");
  await expect(page.locator(".vivarium-2d-app")).toHaveCount(0);
  await page.waitForFunction(() => window.__vivariumWorld?.isReady === true);
  await expect(page.getByRole("navigation", { name: "Observatory views" })).toBeVisible();
  await expect(productionCanvas).toHaveCount(0);

  await changeRendererRoute(page, "/?renderer=2d");
  await page.waitForFunction((cursor) => {
    const app = document.querySelector(".vivarium-2d-app");
    const stage = document.querySelector(".presentation-world-stage");
    return app?.getAttribute("data-presented-cursor") === String(cursor)
      && stage?.getAttribute("data-ready") === "true";
  }, livingAtlasWorld.event_cursor);
  await expect(productionCanvas).toHaveCount(1);
  await productionCanvas.focus();
  await page.keyboard.press("v");
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-camera-mode", "free");
  await page.keyboard.press("s");
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-camera-mode", "story");
  await page.getByRole("button", { name: "Chronicle" }).click();
  await expect(page.getByRole("heading", { name: "Chronicle" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Chronicle" })).toBeFocused();
  expect(browserErrors).toEqual([]);
});

test("contrast, reduced motion, forced colors, and one live region preserve meaning", async ({ page }) => {
  await installProductionFixture(page, { width: 390, height: 844 }, semanticSubjectWorld());
  // The region switcher (`LivingAtlas2D`) only mounts inside the World
  // drawer, which starts closed for every viewport — open it first.
  await page.getByRole("button", { name: "World", exact: true }).click();
  const nirvana = page.getByRole("button", { name: /^Observe Nirvana (?!East|West)/ });
  await nirvana.focus();
  await page.keyboard.press("Enter");
  const aster = page.getByRole("region", { name: "World subjects" })
    .getByRole("button", { name: /^Aster Status:/ });
  await aster.focus();
  await page.keyboard.press("Enter");
  await expect(aster).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-reduced-motion", "true");
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-camera-mode", "free");
  await expect(nirvana).toHaveAttribute("aria-pressed", "true");
  await expect(aster).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Vivarium world")).toHaveCount(1);
  expect(await page.locator('[role="status"][aria-live="polite"]').count()).toBe(1);
  await page.keyboard.press("Tab");

  const semantics = await page.evaluate(() => ({
    activeRegion: document.querySelector(".living-atlas-2d__observe")?.getAttribute("aria-current"),
    observedRegion: document.querySelector(".living-atlas-2d__observe")?.getAttribute("aria-pressed"),
    transitions: Array.from(document.querySelectorAll<HTMLElement>("button, .observer-drawer"))
      .map((node) => getComputedStyle(node).transitionDuration),
    focusRules: document.activeElement instanceof HTMLElement
      ? getComputedStyle(document.activeElement).outlineWidth
      : "0px",
  }));
  expect(["page", "location", null]).toContain(semantics.activeRegion);
  expect(["true", "false"]).toContain(semantics.observedRegion);
  expect(semantics.transitions.every((duration) => duration === "0s")).toBe(true);
  expect(Number.parseFloat(semantics.focusRules)).toBeGreaterThanOrEqual(3);
});

interface MobileHitTargetAudit {
  readonly control: string;
  readonly owner: boolean;
  readonly hit: string | null;
  readonly width: number;
  readonly height: number;
}

interface MobileObserverChromeAudit {
  readonly cameraSafeHeight: number;
  readonly cameraSafeTop: number;
  readonly atlasPresent: boolean;
  readonly cameraSafeWidth: number;
  readonly triggerCount: number;
  readonly intersections: readonly Readonly<{ trigger: string; target: string }>[];
  readonly atlasHitTargets: readonly MobileHitTargetAudit[];
  readonly triggerHitTargets: readonly MobileHitTargetAudit[];
  readonly triggerStripBottom: number;
  readonly stripEdgeGaps: Readonly<{ left: number; right: number }> | null;
  readonly overflowX: number;
  readonly overflowY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

async function auditMobileObserverChrome(page: Page): Promise<MobileObserverChromeAudit> {
  return page.evaluate(async () => {
    const atlas = document.querySelector<HTMLElement>(".living-atlas-2d");
    const strip = document.querySelector<HTMLElement>(".observer-edge-triggers");
    const edgeTriggers = Array.from(document.querySelectorAll<HTMLButtonElement>(
      ".observer-edge-triggers button",
    ));
    const momentTrigger = document.querySelector<HTMLButtonElement>(".story-now > button");
    const triggers = momentTrigger === null
      ? edgeTriggers
      : [...edgeTriggers, momentTrigger];
    const atlasControls = Array.from(document.querySelectorAll<HTMLButtonElement>(
      ".living-atlas-2d button",
    )).filter((control) => {
      const rect = control.getBoundingClientRect();
      const style = getComputedStyle(control);
      return rect.width > 0 && rect.height > 0
        && style.display !== "none" && style.visibility !== "hidden";
    });
    const atlasTargets = atlas === null ? [] : [atlas, ...atlasControls];
    const intersections = triggers.flatMap((trigger) => {
      const triggerRect = trigger.getBoundingClientRect();
      return atlasTargets.flatMap((target) => {
        const targetRect = target.getBoundingClientRect();
        const overlaps = Math.min(triggerRect.right, targetRect.right)
            - Math.max(triggerRect.left, targetRect.left) > 0
          && Math.min(triggerRect.bottom, targetRect.bottom)
            - Math.max(triggerRect.top, targetRect.top) > 0;
        return overlaps ? [{
          trigger: trigger.textContent?.trim() ?? "",
          target: target.className,
        }] : [];
      });
    });
    const hitTarget = (control: HTMLButtonElement): MobileHitTargetAudit => {
      const rect = control.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return {
        control: control.getAttribute("aria-label") ?? control.textContent?.trim() ?? "",
        owner: hit instanceof Element && (hit === control || control.contains(hit)),
        hit: hit instanceof HTMLElement ? hit.className : hit?.tagName ?? null,
        width: rect.width,
        height: rect.height,
      };
    };
    const stripRect = strip?.getBoundingClientRect() ?? null;
    const firstTriggerRect = edgeTriggers[0]?.getBoundingClientRect() ?? null;
    const lastTriggerRect = edgeTriggers.at(-1)?.getBoundingClientRect() ?? null;
    const debug = await import("/src/renderer2d/production/debug.ts");
    const stage = document.querySelector(".presentation-world-stage");
    return {
      cameraSafeHeight: stage === null
        ? 0
        : (debug.getProductionStageDebugProbe(stage)?.snapshot().camera.safeFrame.height ?? 0),
      cameraSafeTop: stage === null
        ? 0
        : (debug.getProductionStageDebugProbe(stage)?.snapshot().camera.safeFrame.y ?? 0),
      atlasPresent: atlas !== null,
      cameraSafeWidth: stage === null
        ? 0
        : (debug.getProductionStageDebugProbe(stage)?.snapshot().camera.safeFrame.width ?? 0),
      triggerCount: triggers.length,
      intersections,
      atlasHitTargets: atlasControls.map(hitTarget),
      triggerHitTargets: triggers.map(hitTarget),
      triggerStripBottom: stripRect?.bottom ?? 0,
      stripEdgeGaps: stripRect === null || firstTriggerRect === null || lastTriggerRect === null
        ? null
        : {
            left: firstTriggerRect.left - stripRect.left,
            right: stripRect.right - lastTriggerRect.right,
          },
      overflowX: document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth,
      overflowY: document.scrollingElement!.scrollHeight - document.scrollingElement!.clientHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
}

function assertMobileObserverChrome(
  audit: MobileObserverChromeAudit,
  expectedTriggerCount: 3 | 4,
  label: string,
): void {
  expect(audit.atlasPresent, `${label} atlas`).toBe(true);
  expect(audit.cameraSafeWidth, `${label} camera safe width`)
    .toBeGreaterThanOrEqual(audit.viewportWidth * 0.75);
  expect(audit.cameraSafeTop, `${label} camera safe top below trigger strip`)
    .toBeGreaterThanOrEqual(audit.triggerStripBottom + 8);
  expect(audit.cameraSafeHeight, `${label} material camera safe height`)
    .toBeGreaterThanOrEqual(audit.viewportHeight * 0.24);
  expect(audit.triggerCount, `${label} trigger count`).toBe(expectedTriggerCount);
  expect(audit.intersections, `${label} overlay intersections`).toEqual([]);
  expect(audit.atlasHitTargets.length, `${label} visible atlas controls`).toBeGreaterThan(0);
  expect(audit.atlasHitTargets, `${label} atlas hit ownership`).toEqual(
    audit.atlasHitTargets.map((target) => ({ ...target, owner: true })),
  );
  expect(audit.triggerHitTargets, `${label} trigger hit ownership`).toEqual(
    audit.triggerHitTargets.map((target) => ({ ...target, owner: true })),
  );
  expect(audit.atlasHitTargets.every((target) => target.width >= 44 && target.height >= 44), label)
    .toBe(true);
  expect(audit.triggerHitTargets.every((target) => target.width >= 44 && target.height >= 44), label)
    .toBe(true);
  expect(audit.stripEdgeGaps, `${label} strip edge ownership`).not.toBeNull();
  expect(Math.abs(audit.stripEdgeGaps!.left), `${label} strip left gap`).toBeLessThanOrEqual(1);
  expect(Math.abs(audit.stripEdgeGaps!.right), `${label} strip right gap`).toBeLessThanOrEqual(1);
  expect(audit.overflowX, `${label} horizontal overflow`).toBeLessThanOrEqual(1);
  expect(audit.overflowY, `${label} vertical overflow`).toBeLessThanOrEqual(1);
}

async function installProductionFixture(
  page: Page,
  viewport: { width: number; height: number },
  world = livingAtlasWorld,
  reducedMotion: "reduce" | "no-preference" = "no-preference",
): Promise<void> {
  await installLivingAtlasFixture(page, {
    viewport,
    world,
    reducedMotion,
    routePath: "/?renderer=2d",
  });
}

async function changeRendererRoute(page: Page, href: string): Promise<void> {
  await page.evaluate((nextHref) => {
    window.history.pushState({}, "", nextHref);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, href);
}

function sameRegionWorld(): typeof livingAtlasWorld {
  return {
    ...livingAtlasWorld,
    agents: livingAtlasWorld.agents.map((agent) => ({ ...agent, position: "nirvana" })),
    homes: livingAtlasWorld.homes.map((home) => ({ ...home, region: "nirvana" })),
    ruins: livingAtlasWorld.ruins.map((ruin) => ({ ...ruin, region: "nirvana" })),
  };
}

function semanticSubjectWorld(): typeof livingAtlasWorld {
  const world = sameRegionWorld();
  return {
    ...world,
    agents: world.agents.filter((agent) => ["agent_healthy", "agent_dead"].includes(agent.id)),
    homes: world.homes.filter((home) => home.home_id === "home_001"),
    ruins: world.ruins.filter((ruin) => ruin.home_id === "home_old"),
  };
}
