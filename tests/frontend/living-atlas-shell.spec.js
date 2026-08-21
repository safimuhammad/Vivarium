const { test, expect } = require('@playwright/test');

const studyPath = '/docs/frontend/mockups/studies/living-atlas-shell.html';

async function expectNoDocumentScroll(page) {
  await expect.poll(async () => page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth <= window.innerWidth,
    vertical: document.documentElement.scrollHeight <= window.innerHeight,
  }))).toEqual({ horizontal: true, vertical: true });
}

async function expectReadableMetadata(page, selector) {
  const style = await page.locator(selector).first().evaluate((element) => {
    const computed = getComputedStyle(element);
    const alphaMatch = computed.color.match(/rgba?\([^,]+,[^,]+,[^,]+(?:,\s*([\d.]+))?\)/);
    return {
      fontSize: Number.parseFloat(computed.fontSize),
      alpha: alphaMatch?.[1] === undefined ? 1 : Number.parseFloat(alphaMatch[1]),
    };
  });
  expect(style.fontSize, `${selector} font size`).toBeGreaterThanOrEqual(10.5);
  expect(style.alpha, `${selector} text alpha`).toBeGreaterThanOrEqual(0.58);
}

test('Living Atlas study keeps the world full-screen and owns one surface', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(studyPath);
  const stage = page.locator('[data-testid="atlas-study-stage"]');
  await expect(stage).toBeVisible();
  const box = await stage.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(1439);
  expect(box.height).toBeGreaterThanOrEqual(899);
  await expectNoDocumentScroll(page);
  await expect(page.locator('.atlas-beat:visible')).toHaveCount(3);
  for (const selector of [
    '.atlas-edge-copy small',
    '.atlas-beat-copy small',
    '.atlas-entity-copy small',
    '.atlas-region small',
    '.atlas-selection-name small',
    '.atlas-fact span:first-child',
    '.atlas-chronicle-copy small',
  ]) {
    await expectReadableMetadata(page, selector);
  }
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(0);
  const chronicleTrigger = page.getByRole('button', { name: 'Open chronicle' });
  const worldTrigger = page.getByRole('button', { name: 'Open world' });
  await chronicleTrigger.click();
  await expect(chronicleTrigger).toHaveAttribute('data-active', 'true');
  await expect(chronicleTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-atlas-surface="chronicle"][data-open="true"]')).toBeVisible();
  await worldTrigger.click();
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(1);
  await expect(page.locator('[data-atlas-surface="world"][data-open="true"]')).toBeVisible();
  await expect(worldTrigger).toHaveAttribute('data-active', 'true');
  await expect(chronicleTrigger).toHaveAttribute('data-active', 'false');
  const drawer = await page.locator('[data-atlas-surface="world"][data-open="true"]').boundingBox();
  expect(drawer.x).toBeGreaterThan(1440 / 2);
  expect(drawer.y).toBeLessThanOrEqual(20);
  expect(drawer.height).toBeGreaterThan(860);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(0);
  await expect(worldTrigger).toHaveAttribute('data-active', 'false');
});

test('Living Atlas study reprioritizes a very short desktop without scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1498, height: 265 });
  await page.goto(studyPath);
  await expectNoDocumentScroll(page);
  const stage = page.locator('[data-testid="atlas-study-stage"]');
  await expect(stage).toHaveCSS('position', 'fixed');
  await expect(stage).toHaveAttribute('data-atlas-framing', 'short');
  const frameState = await stage.evaluate((frame) => ({
    vivariumReady: Boolean(frame.contentWindow?.__viv?.camera),
    studyStyleInjected: [...frame.contentDocument.querySelectorAll('style')]
      .some((style) => style.textContent.includes('.chip3d{display:none!important}')),
  }));
  expect(frameState).toEqual({ vivariumReady: true, studyStyleInjected: true });
  const cameraDistance = await stage.evaluate((frame) => {
    const vivarium = frame.contentWindow?.__viv;
    return vivarium.camera.position.distanceTo(vivarium.controls.target);
  });
  expect(cameraDistance).toBeLessThanOrEqual(93);
  await expect(page.locator('.atlas-beat:visible')).toHaveCount(1);
  const world = page.frameLocator('[data-testid="atlas-study-stage"]');
  const regionLabels = world.locator('.rlabel');
  await expect(regionLabels).toHaveCount(4);
  const labelRects = await regionLabels.evaluateAll((labels) => labels.map((label) => {
    const rect = label.getBoundingClientRect();
    return {
      label: label.textContent.trim(),
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    };
  }));
  const labelFootprint = Math.max(...labelRects.map((rect) => rect.right)) -
    Math.min(...labelRects.map((rect) => rect.left));
  const overlaps = labelRects.flatMap((left, leftIndex) =>
    labelRects.slice(leftIndex + 1).filter((right) =>
      left.left < right.right && left.right > right.left &&
      left.top < right.bottom && left.bottom > right.top,
    ),
  );
  const ribbon = await page.locator('.atlas-story-ribbon').boundingBox();
  expect(labelFootprint).toBeGreaterThanOrEqual(620);
  expect(overlaps).toHaveLength(0);
  for (const rect of labelRects) {
    const intersectsViewport = rect.right > 0 && rect.left < 1498 &&
      rect.bottom > 0 && rect.top < 265;
    expect(intersectsViewport, `${rect.label} intersects the iframe viewport`).toBe(true);
    expect(rect.left, `${rect.label} left edge`).toBeGreaterThanOrEqual(-6);
    expect(rect.right, `${rect.label} right edge`).toBeLessThanOrEqual(1504);
    expect(rect.top, `${rect.label} top edge`).toBeGreaterThanOrEqual(-6);
    expect(rect.bottom, `${rect.label} bottom edge`).toBeLessThanOrEqual(271);
    const obscuredByRibbon = rect.left < ribbon.x + ribbon.width && rect.right > ribbon.x &&
      rect.top < ribbon.y + ribbon.height && rect.bottom > ribbon.y;
    expect(obscuredByRibbon, `${rect.label} remains clear of the story ribbon`).toBe(false);
  }
  await page.getByRole('button', { name: 'Open chronicle' }).click();
  const chronicle = page.locator('[data-atlas-surface="chronicle"][data-open="true"]');
  await expect(chronicle).toBeVisible();
  const drawer = await chronicle.boundingBox();
  expect(drawer.x).toBeGreaterThan(1498 / 2);
  expect(drawer.y).toBeLessThanOrEqual(10);
  expect(drawer.height).toBeGreaterThanOrEqual(245);
  await page.getByRole('button', { name: 'Open world' }).click();
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(1);
  await expectNoDocumentScroll(page);
});

test('Living Atlas study presents one owned bottom sheet on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(studyPath);
  await expectNoDocumentScroll(page);
  await expect(page.locator('.atlas-beat:visible')).toHaveCount(1);
  await page.getByRole('button', { name: 'Open chronicle' }).click();
  const chronicle = page.locator('[data-atlas-surface="chronicle"][data-open="true"]');
  await expect(chronicle).toBeVisible();
  const close = await page.getByRole('button', { name: 'Close chronicle' }).boundingBox();
  expect(close.width).toBeGreaterThanOrEqual(44);
  expect(close.height).toBeGreaterThanOrEqual(44);
  const sheet = await chronicle.boundingBox();
  expect(sheet.x).toBeLessThanOrEqual(10);
  expect(sheet.width).toBeGreaterThanOrEqual(374);
  expect(sheet.y).toBeGreaterThan(844 / 3);
  expect(844 - (sheet.y + sheet.height)).toBeLessThanOrEqual(10);
  await page.getByRole('button', { name: 'Open world' }).click();
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(1);
  await expect(page.locator('[data-atlas-surface="world"][data-open="true"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveCount(0);
  await expectNoDocumentScroll(page);
});
