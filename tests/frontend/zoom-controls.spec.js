const { test, expect } = require('@playwright/test');

async function waitForWorld(page) {
  await page.goto('/docs/frontend/mockups/v4-threejs-world.html');
  await page.waitForFunction(() => {
    const viv = window.__viv;
    const fallback = document.getElementById('fallback');
    return viv && viv.camera && viv.controls && !fallback.classList.contains('show');
  });
}

async function cameraState(page) {
  return page.evaluate(() => {
    const { camera, controls } = window.__viv;
    return {
      distance: camera.position.distanceTo(controls.target),
      target: controls.target.toArray(),
      zoomSpeed: controls.zoomSpeed,
      minDistance: controls.minDistance,
      zoomToCursor: controls.zoomToCursor,
    };
  });
}

test('wheel zoom is sensitive enough for trackpads', async ({ page }) => {
  await waitForWorld(page);
  const before = await cameraState(page);

  await page.mouse.move(840, 470);
  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(650);
  const after = await cameraState(page);

  expect(after.zoomSpeed).toBeGreaterThanOrEqual(3.4);
  expect(after.zoomToCursor).toBe(true);
  expect(after.minDistance).toBeLessThanOrEqual(3.2);
  expect(after.distance).toBeLessThan(before.distance - 25);
});

test('clicking island land focuses the camera into that exact area', async ({ page }) => {
  await waitForWorld(page);

  await page.mouse.click(1080, 325);
  await page.waitForTimeout(950);
  const after = await cameraState(page);

  expect(after.distance).toBeLessThanOrEqual(19);
  expect(after.target[0]).toBeGreaterThan(40);
  expect(after.target[2]).toBeLessThan(5);
});
