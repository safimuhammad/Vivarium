import { expect, test, type Page } from "@playwright/test";

import {
  installLivingAtlasFixture,
  livingAtlasStoryEnvelope,
  livingAtlasWorld,
} from "./living-atlas-fixture";

async function dispatchStory(page: Page): Promise<void> {
  await page.evaluate((body) => window.__vivariumDispatchCaptureEvent?.(body), livingAtlasStoryEnvelope);
  await page.waitForFunction((cursor) => (
    window.__vivariumLiveRun?.diagnostics().eventCursor === cursor
    && document.querySelectorAll(".story-ribbon-beat").length > 0
  ), livingAtlasStoryEnvelope.next_cursor);
}

async function openSurface(page: Page, kind: "world" | "chronicle" | "archive"): Promise<void> {
  const name = {
    world: "Open world — World Beings & land",
    chronicle: "Open chronicle — Chronicle Living memory",
    archive: "Open archive — Archive Preserved view",
  }[kind];
  const trigger = page.getByRole("button", { name, exact: true });
  await trigger.click();
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveAttribute(
    "data-atlas-surface",
    kind,
  );
  await expect(page.locator("#living-atlas-surface-heading")).toBeFocused();
}

async function visibleControlSizes(page: Page): Promise<Array<{ label: string; width: number; height: number }>> {
  return page.locator('button, [role="button"], input, select, textarea').evaluateAll((nodes) => nodes.flatMap((node) => {
    const element = node as HTMLElement;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (
      rect.width <= 0
      || rect.height <= 0
      || style.display === "none"
      || style.visibility === "hidden"
    ) {
      return [];
    }
    return [{
      label: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName,
      width: rect.width,
      height: rect.height,
      minHeight: style.minHeight,
      transform: style.transform,
    }];
  }));
}

test("Living Atlas exposes named global landmarks and no orphan controls", async ({ page }) => {
  await installLivingAtlasFixture(page, { viewport: { width: 1440, height: 900 } });
  await dispatchStory(page);

  await expect(page).toHaveTitle("Vivarium Observatory");
  expect(await page.locator("html").getAttribute("lang")).toBe("en");
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    /width=device-width.*initial-scale=1\.0/,
  );
  await expect(page.getByRole("region", { name: "Vivarium world" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Three dimensional Vivarium world" })).toHaveAttribute(
    "tabindex",
    "0",
  );
  await expect(page.getByRole("navigation", { name: "Observatory views" })).toBeVisible();
  await expect(page.getByRole("region", { name: "World story" })).toBeVisible();

  for (const kind of ["world", "chronicle", "archive"] as const) {
    await openSurface(page, kind);
    const audit = await page.evaluate(() => {
      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const accessibleName = (element: Element): string => {
        const labelledBy = element.getAttribute("aria-labelledby");
        if (labelledBy) {
          return labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
        }
        const id = element.getAttribute("id");
        const explicitLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
        return (
          element.getAttribute("aria-label")
          ?? explicitLabel?.textContent
          ?? element.getAttribute("title")
          ?? element.textContent
          ?? ""
        ).replace(/\s+/g, " ").trim();
      };
      const controls = Array.from(document.querySelectorAll("button, input, select, textarea"))
        .filter(visible);
      return {
        unnamed: controls.filter((element) => accessibleName(element) === "").map((element) => element.outerHTML),
        orphanForms: controls.filter((element) => (
          element.matches("input, select, textarea") && accessibleName(element) === ""
        )).map((element) => element.outerHTML),
        openSurfaces: document.querySelectorAll('[data-atlas-surface][data-open="true"]').length,
        surfaceRole: document.querySelector('[data-atlas-surface][data-open="true"]')?.getAttribute("role"),
      };
    });
    expect(audit.unnamed, `${kind} unnamed controls`).toEqual([]);
    expect(audit.orphanForms, `${kind} orphan form controls`).toEqual([]);
    expect(audit.openSurfaces).toBe(1);
    expect(audit.surfaceRole).toBe("complementary");
    await page.keyboard.press("Escape");
  }
});

test("Living Atlas keyboard path enters, traps, and returns focus without losing the world", async ({ page }) => {
  await installLivingAtlasFixture(page, { viewport: { width: 1440, height: 900 } });
  await dispatchStory(page);
  const stage = page.getByLabel("Three dimensional Vivarium world");
  const worldTrigger = page.getByRole("button", {
    name: "Open world — World Beings & land",
    exact: true,
  });

  await stage.focus();
  for (let index = 0; index < 5 && !(await worldTrigger.evaluate((node) => node === document.activeElement)); index += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(worldTrigger).toBeFocused();
  const focusStyle = await worldTrigger.evaluate((node) => {
    const style = getComputedStyle(node);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor };
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Enter");
  await expect(page.locator("#living-atlas-surface-heading")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(worldTrigger).toBeFocused();

  expect(await page.evaluate(() => window.__vivariumWorld?.focusAgent("agent_healthy"))).toBe(true);
  await page.waitForFunction(() => (
    (window.__vivariumWorld?.agentVisualState("agent_healthy")?.screenHeight ?? 0) >= 120
  ));
  const point = await page.evaluate(() => window.__vivariumWorld?.screenPointForAgent("agent_healthy"));
  if (!point) {
    throw new Error("The healthy mystic did not expose a projected hit target.");
  }
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveAttribute(
    "data-atlas-surface",
    "selection",
  );
  await page.keyboard.press("Escape");
  await expect(stage).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  const chronicleTrigger = page.getByRole("button", {
    name: "Open chronicle — Chronicle Living memory",
    exact: true,
  });
  await chronicleTrigger.click();
  const surface = page.locator('[data-atlas-surface][data-open="true"]');
  await expect(surface).toHaveAttribute("role", "dialog");
  await expect(surface).toHaveAttribute("aria-modal", "true");
  await expect(page.locator("#living-atlas-surface-heading")).toBeFocused();
  await page.keyboard.press("Tab");
  const close = page.getByRole("button", { name: "Close chronicle" });
  await expect(close).toBeFocused();
  const lastAction = surface.locator("button, input, select, textarea").last();
  await lastAction.focus();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(chronicleTrigger).toBeFocused();
});

test("Living Atlas keeps compact controls touch-sized and preserves meaning with reduced motion", async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1498, height: 265 },
  ]) {
    await installLivingAtlasFixture(page, { viewport, reducedMotion: "reduce" });
    await dispatchStory(page);
    await openSurface(page, "chronicle");
    const undersized = (await visibleControlSizes(page)).filter(({ width, height }) => width < 44 || height < 44);
    expect(undersized, `${viewport.width}x${viewport.height} touch targets`).toEqual([]);
    const motion = await page.evaluate(() => ({
      renderer: window.__vivariumWorld?.motionMode(),
      atmosphere: window.__vivariumWorld?.atmosphereState(),
      storyCursors: Array.from(document.querySelectorAll(".story-ribbon-beat"))
        .map((node) => Number(node.getAttribute("data-event-cursor"))),
      chronicleCursors: Array.from(document.querySelectorAll('.chronicle [data-event-kind="event"]'))
        .map((node) => Number(node.getAttribute("data-event-cursor"))),
      overflowX: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
      overflowY: document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
      bubbleCount: document.querySelectorAll(".viv-event-bubble").length,
      clippedBubbles: Array.from(document.querySelectorAll(".viv-event-bubble")).flatMap((node) => {
        const element = node as HTMLElement;
        const rect = element.getBoundingClientRect();
        return (
          element.scrollWidth > element.clientWidth + 1
          || element.scrollHeight > element.clientHeight + 1
          || rect.left < -1
          || rect.right > innerWidth + 1
          || rect.top < -1
          || rect.bottom > innerHeight + 1
        ) ? [element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "bubble"] : [];
      }),
    }));
    expect(motion.renderer).toMatchObject({ reduced: true, mode: "reduced" });
    expect(motion.atmosphere).toMatchObject({
      phaseSource: "reduced-motion",
      key: "golden-hour",
    });
    expect(motion.atmosphere?.phase).toBeCloseTo(0.14, 8);
    expect(motion.storyCursors.length).toBe(1);
    expect(motion.chronicleCursors).toEqual(expect.arrayContaining([41, 42, 43]));
    expect(motion.bubbleCount).toBeLessThanOrEqual(1);
    expect(motion.clippedBubbles).toEqual([]);
    expect(motion.overflowX).toBeLessThanOrEqual(1);
    expect(motion.overflowY).toBeLessThanOrEqual(1);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});

test("Living Atlas primary copy clears solid HUD, story, and drawer contrast thresholds", async ({ page }) => {
  await installLivingAtlasFixture(page, { viewport: { width: 1440, height: 900 } });
  await dispatchStory(page);
  await openSurface(page, "chronicle");
  const contrast = await page.evaluate(() => {
    type Rgb = { r: number; g: number; b: number; a: number };
    const parse = (value: string): Rgb => {
      const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return { r: channels[0] ?? 0, g: channels[1] ?? 0, b: channels[2] ?? 0, a: channels[3] ?? 1 };
    };
    const blend = (foreground: Rgb, background: Rgb): Rgb => ({
      r: foreground.r * foreground.a + background.r * (1 - foreground.a),
      g: foreground.g * foreground.a + background.g * (1 - foreground.a),
      b: foreground.b * foreground.a + background.b * (1 - foreground.a),
      a: 1,
    });
    const luminance = (color: Rgb): number => {
      const channel = (value: number): number => {
        const normalized = value / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    };
    const ratio = (foreground: Rgb, background: Rgb): number => {
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return (light + 0.05) / (dark + 0.05);
    };
    const base = { r: 9, g: 13, b: 14, a: 1 };
    const samples = [
      ["HUD value", ".hud-chip b", ".top-hud"],
      ["edge label", ".atlas-edge-copy strong", ".atlas-edge-trigger"],
      ["story label", ".story-ribbon-label", ".story-ribbon-beat"],
      ["drawer title", ".atlas-surface-head h2", ".atlas-drawer"],
      ["Chronicle event", ".event-type", ".atlas-drawer"],
    ] as const;
    return samples.map(([label, textSelector, surfaceSelector]) => {
      const text = document.querySelector(textSelector);
      const surface = document.querySelector(surfaceSelector);
      if (!(text instanceof HTMLElement) || !(surface instanceof HTMLElement)) {
        return { label, ratio: 0, missing: true };
      }
      const background = blend(parse(getComputedStyle(surface).backgroundColor), base);
      const foreground = blend(parse(getComputedStyle(text).color), background);
      return { label, ratio: ratio(foreground, background), missing: false };
    });
  });
  expect(contrast.filter(({ missing }) => missing)).toEqual([]);
  for (const sample of contrast) {
    expect(sample.ratio, `${sample.label} contrast ${sample.ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  }
});

test("Living Atlas edge chrome keeps complete copy or compact icons outside the atlas safe frame", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900, compact: false },
    { width: 1024, height: 768, compact: false },
    { width: 1498, height: 265, compact: true },
    { width: 390, height: 844, compact: true },
  ]) {
    await installLivingAtlasFixture(page, { viewport });
    const state = await page.evaluate((regionNames) => {
      const rect = (selector: string): DOMRect | null => (
        document.querySelector<HTMLElement>(selector)?.getBoundingClientRect() ?? null
      );
      const hud = rect(".top-hud");
      const edge = rect(".atlas-edge-controls");
      const intersect = (left: DOMRect | null, right: DOMRect | null): boolean => Boolean(
        left && right
        && Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1
        && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1
      );
      const chrome = [hud, edge].filter((item): item is DOMRect => item !== null);
      const centroids = regionNames.map((name) => ({
        name,
        point: window.__vivariumWorld?.screenPointForRegion(name),
      }));
      const pointInside = (point: { x: number; y: number } | null | undefined, box: DOMRect): boolean => Boolean(
        point && point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom
      );
      return {
        documentOverflow: {
          x: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
          y: document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
        },
        hudEdgeOverlap: intersect(hud, edge),
        obscuredCentroids: centroids.flatMap(({ name, point }) => (
          chrome.some((box) => pointInside(point, box)) ? [name] : []
        )),
        edgeCopy: Array.from(document.querySelectorAll<HTMLElement>(".atlas-edge-copy strong, .atlas-edge-copy small"))
          .map((element) => {
            const bounds = element.getBoundingClientRect();
            return {
              text: element.textContent?.trim() ?? "",
              visible: bounds.width > 0 && bounds.height > 0 && getComputedStyle(element).display !== "none",
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
              clientHeight: element.clientHeight,
              scrollHeight: element.scrollHeight,
            };
          }),
        triggerRects: Array.from(document.querySelectorAll<HTMLElement>(".atlas-edge-trigger")).map((element) => {
          const bounds = element.getBoundingClientRect();
          return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
        }),
      };
    }, livingAtlasWorld.regions.map(({ name }) => name));
    expect(state.documentOverflow.x, `${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);
    expect(state.documentOverflow.y, `${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);
    expect(state.hudEdgeOverlap, `${viewport.width}x${viewport.height}`).toBe(false);
    expect(state.obscuredCentroids, `${viewport.width}x${viewport.height}`).toEqual([]);
    for (const trigger of state.triggerRects) {
      expect(trigger.left).toBeGreaterThanOrEqual(-1);
      expect(trigger.top).toBeGreaterThanOrEqual(-1);
      expect(trigger.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(trigger.bottom).toBeLessThanOrEqual(viewport.height + 1);
    }
    if (viewport.compact) {
      expect(state.edgeCopy.every(({ visible }) => !visible)).toBe(true);
    } else {
      expect(state.edgeCopy.every(({ visible }) => visible)).toBe(true);
      expect(state.edgeCopy.flatMap((copy) => (
        copy.scrollWidth > copy.clientWidth + 1 || copy.scrollHeight > copy.clientHeight + 1
          ? [copy]
          : []
      ))).toEqual([]);
    }
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});
