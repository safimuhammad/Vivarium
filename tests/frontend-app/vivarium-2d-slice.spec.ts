import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import type { ShelterSnapshot2D } from "../../frontend/src/renderer2d/homes/ShelterActor";
import { shelterVisualBounds } from "../../frontend/src/renderer2d/homes/shelterGeometry";

type Point = { x: number; y: number };
type ActorState = {
  instanceId: number;
  position: Point;
  facing: "north" | "east" | "south" | "west";
  channels: {
    locomotion: string;
    action: string;
    face: string;
    facing: "north" | "east" | "south" | "west";
    heldObject: string | null;
    selected: boolean;
  };
  layers: {
    body: { clipId: string; frameIndex: number; sourceRect: { x: number; y: number; width: number; height: number } };
    face: { clipId: string; frameIndex: number; sourceRect: { x: number; y: number; width: number; height: number } };
    held: { clipId: string; frameIndex: number; sourceRect: { x: number; y: number; width: number; height: number } };
  };
  frameIndex: number;
  distanceTravelled: number;
};
type CameraState = {
  mode: "story" | "follow" | "free";
  center: Point;
  zoom: number;
  followEntityId: string | null;
  storyTarget: { x: number; y: number; width: number; height: number } | null;
  pendingStoryTarget: { x: number; y: number; width: number; height: number } | null;
  safeFrame: { x: number; y: number; width: number; height: number };
};
type ShelterComponent = {
  id: "foundation" | "posts" | "walls" | "roof" | "door" | "hearth";
  visibility: number;
  damaged: boolean;
};
type ShelterState = {
  instanceId: number;
  plot: Point;
  phase: "absent" | "building" | "standing" | "collapsing" | "ruin";
  components: ShelterComponent[];
  emittedMarkers: string[];
  buildCommitCount: number;
  collapseCommitCount: number;
};

function actorShelterDistance(actor: ActorState, shelter: ShelterState): number {
  return Math.hypot(actor.position.x - shelter.plot.x, actor.position.y - shelter.plot.y);
}
type SliceDiagnostics = {
  logicalViewport: { width: number; height: number };
  cropMode: "desktop-full" | "mobile-crop";
  activeAnimations: number;
};

declare global {
  interface Window {
    __sliceCanvasIdentity?: HTMLCanvasElement;
    __vivarium2DSlice?: {
      isReady(): boolean;
      pause(): void;
      seek(milliseconds: number): void;
      advanceBy(milliseconds: number): void;
      setScene(scene: "walk" | "dialogue" | "shelter-build" | "shelter-collapse" | "full-loop"): void;
      actorState(id: string): ActorState | null;
      cameraState(): CameraState;
      shelterState(id: string): ShelterState | null;
      renderDiagnostics(): SliceDiagnostics;
    };
  }
}

const ROOT = process.cwd();
const STAGE_SOURCE = resolve(ROOT, "frontend/src/renderer2d/CanvasWorldStage.tsx");

async function bootSlice(
  page: Page,
  scene: "walk" | "dialogue" | "shelter-build" | "shelter-collapse" | "full-loop" = "full-loop",
  options: {
    viewport?: { width: number; height: number };
    reducedMotion?: "reduce" | "no-preference";
  } = {},
): Promise<void> {
  if (options.viewport) await page.setViewportSize(options.viewport);
  await page.emulateMedia({ reducedMotion: options.reducedMotion ?? "no-preference" });
  await page.goto(`/?renderer=2d-slice&scene=${scene}`);
  await page.waitForFunction(() => window.__vivarium2DSlice?.isReady() === true);
  await expect(page.getByTestId("vivarium-2d-slice")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => window.__vivarium2DSlice!.pause());
}

async function actorPointer(page: Page): Promise<Point> {
  return page.evaluate(() => {
    const debug = window.__vivarium2DSlice!;
    const actor = debug.actorState("agent_aster")!;
    const camera = debug.cameraState();
    const diagnostics = debug.renderDiagnostics();
    const canvas = document.querySelector<HTMLCanvasElement>(".slice2d__canvas")!;
    const bounds = canvas.getBoundingClientRect();
    const logical = {
      x: (actor.position.x - camera.center.x) * camera.zoom + diagnostics.logicalViewport.width / 2,
      y: (actor.position.y - camera.center.y) * camera.zoom + diagnostics.logicalViewport.height / 2 - 24,
    };
    return {
      x: bounds.left + logical.x * bounds.width / diagnostics.logicalViewport.width,
      y: bounds.top + logical.y * bounds.height / diagnostics.logicalViewport.height,
    };
  });
}

function component(snapshot: ShelterState, id: ShelterComponent["id"]): ShelterComponent {
  const found = snapshot.components.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing shelter component ${id}.`);
  return found;
}

function expectFaceDirectionMatchesBody(actor: ActorState): void {
  const bodyDirection = actor.layers.body.clipId.match(/_(south|west|north|east)$/)?.[1] ?? "south";
  const rows = { south: 0, west: 1, north: 2, east: 3 } as const;
  expect(actor.layers.face.clipId).toMatch(new RegExp(`_${bodyDirection}$`));
  expect(actor.layers.face.sourceRect.y).toBe(rows[bodyDirection as keyof typeof rows] * 64);
}

test.describe.configure({ mode: "serial" });

type BrowserIssue = {
  kind: "console" | "pageerror";
  text: string;
  location: string;
};

const browserIssues = new WeakMap<Page, BrowserIssue[]>();

test.beforeEach(async ({ page }) => {
  const issues: BrowserIssue[] = [];
  browserIssues.set(page, issues);
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    issues.push({ kind: "console", text: message.text(), location: message.location().url });
  });
  page.on("pageerror", (error) => {
    issues.push({ kind: "pageerror", text: error.message, location: "" });
  });
});

test.afterEach(async ({ page }, testInfo) => {
  const allowsIntentionalShelterFailure = testInfo.title.includes("static closure and browser requests");
  const unexpected = (browserIssues.get(page) ?? []).filter((issue) => !(
    allowsIntentionalShelterFailure
    && issue.kind === "console"
    && /shelter-slice-atlas/i.test(issue.location)
    && /failed to load resource|err_failed/i.test(issue.text)
  ));
  expect(unexpected, `Unexpected browser console/page errors:\n${JSON.stringify(unexpected, null, 2)}`).toEqual([]);
});

test("one persistent human walks through intermediate positions and frames", async ({ page }) => {
  await bootSlice(page, "walk");
  await page.evaluate(() => {
    window.__sliceCanvasIdentity = document.querySelector<HTMLCanvasElement>(".slice2d__canvas")!;
    window.__vivarium2DSlice!.seek(800);
  });

  const samples: ActorState[] = [];
  for (let index = 0; index < 10; index += 1) {
    await page.evaluate(() => window.__vivarium2DSlice!.advanceBy(90));
    samples.push(await page.evaluate(() => window.__vivarium2DSlice!.actorState("agent_aster")!));
  }

  expect(new Set(samples.map((sample) => sample.position.x)).size, JSON.stringify(samples.map((sample) => ({
    position: sample.position,
    frameIndex: sample.frameIndex,
    distanceTravelled: sample.distanceTravelled,
  })))).toBeGreaterThanOrEqual(4);
  expect(new Set(samples.map((sample) => sample.frameIndex)).size).toBeGreaterThanOrEqual(2);
  expect(samples.at(-1)!.distanceTravelled).toBeGreaterThan(samples[0]!.distanceTravelled);
  expect(samples.every((sample) => sample.instanceId === samples[0]!.instanceId)).toBe(true);
  expect(samples.slice(1).every((sample, index) => Math.hypot(
    sample.position.x - samples[index]!.position.x,
    sample.position.y - samples[index]!.position.y,
  ) <= 8)).toBe(true);
  for (const sample of samples) expectFaceDirectionMatchesBody(sample);

  await page.evaluate(() => window.__vivarium2DSlice!.setScene("shelter-build"));
  const initial = await page.evaluate(() => window.__vivarium2DSlice!.actorState("agent_aster")!);
  let elapsedMs = 0;
  let turn: ActorState | null = null;
  for (let index = 0; index < 80 && turn === null; index += 1) {
    await page.evaluate(() => window.__vivarium2DSlice!.advanceBy(20));
    elapsedMs += 20;
    const sample = await page.evaluate(() => window.__vivarium2DSlice!.actorState("agent_aster")!);
    if (sample.channels.locomotion === "turn") turn = sample;
  }
  expect(turn, "a bounded shelter approach must expose its turn state").not.toBeNull();
  expect(turn!.layers.body.clipId).toMatch(/^turn_/);
  expectFaceDirectionMatchesBody(turn!);

  await page.evaluate((delta) => window.__vivarium2DSlice!.advanceBy(delta), 3_728 - elapsedMs);
  const beforeBlink = await page.evaluate(() => window.__vivarium2DSlice!.actorState("agent_aster")!);
  await page.evaluate(() => window.__vivarium2DSlice!.advanceBy(2));
  const blink = await page.evaluate(() => window.__vivarium2DSlice!.actorState("agent_aster")!);
  expect(blink.channels.face).toBe("blink");
  expect(blink.layers.face.clipId).toMatch(/^blink_/);
  expect(blink.layers.body).toEqual(beforeBlink.layers.body);
  expect(blink.layers.held).toEqual(beforeBlink.layers.held);
  expectFaceDirectionMatchesBody(blink);

  await page.evaluate(() => window.__vivarium2DSlice!.advanceBy(2_169));
  const beforeWork = await page.evaluate(() => window.__vivarium2DSlice!.actorState("agent_aster")!);
  await page.evaluate(() => window.__vivarium2DSlice!.advanceBy(2));
  const work = await page.evaluate(() => window.__vivarium2DSlice!.actorState("agent_aster")!);
  expect(work.channels.action).toBe("work");
  expect(work.layers.held.clipId).toBe("work");
  expect(work.layers.body.clipId).toBe(beforeWork.layers.body.clipId);
  expect(work.layers.face).toEqual(beforeWork.layers.face);
  expectFaceDirectionMatchesBody(work);
  expect([initial, turn!, beforeBlink, blink, beforeWork, work]
    .every((sample) => sample.instanceId === initial.instanceId)).toBe(true);
  expect(await page.evaluate(() => document.querySelector(".slice2d__canvas") === window.__sliceCanvasIdentity)).toBe(true);
});

test("pointer and keyboard selection preserve Follow and Free ownership until View moment", async ({ page }) => {
  await bootSlice(page, "walk");
  await page.evaluate(() => {
    window.__sliceCanvasIdentity = document.querySelector<HTMLCanvasElement>(".slice2d__canvas")!;
    window.__vivarium2DSlice!.seek(1_200);
  });

  const point = await actorPointer(page);
  await page.mouse.click(point.x, point.y);
  const actorEntry = page.getByRole("button", { name: /Aster — human/ });
  await expect(actorEntry).toHaveAttribute("aria-pressed", "true");

  await page.evaluate(() => {
    window.__vivarium2DSlice!.setScene("shelter-collapse");
    window.__vivarium2DSlice!.seek(100);
  });
  const canvas = page.getByLabel("Animated Vivarium region");
  await canvas.focus();
  await page.keyboard.press("v");
  for (let index = 0; index < 6; index += 1) await page.keyboard.press("+");
  await page.getByRole("button", { name: "Follow" }).click();
  await page.evaluate(() => window.__vivarium2DSlice!.advanceBy(240));
  await expect(page.getByTestId("vivarium-2d-slice")).toHaveAttribute("data-camera-mode", "follow");

  const shelterEntry = page.getByRole("button", { name: /East shelter/ });
  await shelterEntry.focus();
  await page.keyboard.press("Enter");
  await expect(shelterEntry).toHaveAttribute("aria-pressed", "true");
  const followWithStoryTarget = await page.evaluate(() => window.__vivarium2DSlice!.cameraState());
  expect(followWithStoryTarget.mode).toBe("follow");
  expect(followWithStoryTarget.followEntityId).toBe("agent_aster");
  expect(followWithStoryTarget.pendingStoryTarget).not.toBeNull();
  const pending = followWithStoryTarget.pendingStoryTarget!;
  const standingShelter = await page.evaluate(() => window.__vivarium2DSlice!.shelterState("shelter-east")!);
  expect(standingShelter.phase).toBe("standing");
  expect(pending).toEqual(shelterVisualBounds(standingShelter as unknown as ShelterSnapshot2D));
  const diagnostics = await page.evaluate(() => window.__vivarium2DSlice!.renderDiagnostics());
  const pendingScreenBounds = {
    left: (pending.x - followWithStoryTarget.center.x) * followWithStoryTarget.zoom
      + diagnostics.logicalViewport.width / 2,
    right: (pending.x + pending.width - followWithStoryTarget.center.x) * followWithStoryTarget.zoom
      + diagnostics.logicalViewport.width / 2,
    top: (pending.y - followWithStoryTarget.center.y) * followWithStoryTarget.zoom
      + diagnostics.logicalViewport.height / 2,
    bottom: (pending.y + pending.height - followWithStoryTarget.center.y) * followWithStoryTarget.zoom
      + diagnostics.logicalViewport.height / 2,
  };
  const safe = followWithStoryTarget.safeFrame;
  expect(
    pendingScreenBounds.right <= safe.x
    || pendingScreenBounds.left >= safe.x + safe.width
    || pendingScreenBounds.bottom <= safe.y
    || pendingScreenBounds.top >= safe.y + safe.height,
    `phase-aware shelter bounds ${JSON.stringify(pending)} projected to ${JSON.stringify(pendingScreenBounds)} must not intersect safe frame ${JSON.stringify(safe)}`,
  ).toBe(true);

  await canvas.focus();
  await page.keyboard.press("v");
  const beforeFreeInput = await page.evaluate(() => window.__vivarium2DSlice!.cameraState());
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("-");
  const afterFreeInput = await page.evaluate(() => window.__vivarium2DSlice!.cameraState());
  expect(afterFreeInput.mode).toBe("free");
  expect(afterFreeInput.center.x).not.toBe(beforeFreeInput.center.x);
  expect(afterFreeInput.zoom).not.toBe(beforeFreeInput.zoom);
  await expect(page.getByRole("button", { name: "Free" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "View moment" }).click();
  const beforeStoryAdvance = await page.evaluate(() => window.__vivarium2DSlice!.cameraState());
  await page.evaluate(() => window.__vivarium2DSlice!.advanceBy(2_000));
  const returnedStory = await page.evaluate(() => window.__vivarium2DSlice!.cameraState());
  expect(returnedStory.mode).toBe("story");
  expect(returnedStory.pendingStoryTarget).toBeNull();
  expect(returnedStory.storyTarget).toEqual(pending);
  expect(returnedStory.center).not.toEqual(beforeStoryAdvance.center);
  const storyCenterScreen = {
    x: (pending.x + pending.width / 2 - returnedStory.center.x) * returnedStory.zoom
      + diagnostics.logicalViewport.width / 2,
    y: (pending.y + pending.height / 2 - returnedStory.center.y) * returnedStory.zoom
      + diagnostics.logicalViewport.height / 2,
  };
  expect(storyCenterScreen.x).toBeCloseTo(returnedStory.safeFrame.x + returnedStory.safeFrame.width / 2, 1);
  expect(storyCenterScreen.y).toBeCloseTo(returnedStory.safeFrame.y + returnedStory.safeFrame.height / 2, 1);
  expect(await page.evaluate(() => document.querySelector(".slice2d__canvas") === window.__sliceCanvasIdentity)).toBe(true);
});

test("dialogue remains selectable and focus-stable while live milestones are throttled", async ({ page }) => {
  await bootSlice(page, "dialogue");
  await page.evaluate(() => window.__vivarium2DSlice!.advanceBy(800));
  const dialogue = page.locator(".slice2d__dialogue-text");
  await expect(dialogue).toHaveText("The path remembers every footstep.");
  expect(await dialogue.evaluate((node) => getComputedStyle(node).userSelect)).toBe("text");

  const actorEntry = page.getByRole("button", { name: /Aster — human/ });
  await actorEntry.click();
  await actorEntry.focus();
  const beforeCamera = await page.evaluate(() => window.__vivarium2DSlice!.cameraState().center);
  await dialogue.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.evaluate(() => window.__vivarium2DSlice!.advanceBy(240));
  const afterCamera = await page.evaluate(() => window.__vivarium2DSlice!.cameraState().center);
  expect(afterCamera).not.toEqual(beforeCamera);
  await expect(actorEntry).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("The path remembers every footstep.");

  await bootSlice(page, "shelter-build");
  await page.evaluate(() => window.__vivarium2DSlice!.seek(5_999));
  await expect(page.getByRole("status")).toHaveText("");
  await page.evaluate(() => window.__vivarium2DSlice!.seek(6_001));
  await expect(page.getByRole("status")).toHaveText("Shelter construction began.");
  await page.evaluate(() => {
    const live = document.querySelector(".slice2d__live-region")!;
    (window as Window & { __sliceAnnouncements?: string[] }).__sliceAnnouncements = [];
    new MutationObserver(() => {
      const text = live.textContent?.trim() ?? "";
      if (text) (window as Window & { __sliceAnnouncements?: string[] }).__sliceAnnouncements!.push(text);
    }).observe(live, { childList: true, characterData: true, subtree: true });
  });
  for (let index = 0; index < 15; index += 1) {
    await page.evaluate((timeMs) => window.__vivarium2DSlice!.seek(timeMs), 6_201 + index * 200);
    await expect(page.getByRole("status")).toHaveText("Shelter construction began.");
  }
  expect(await page.evaluate(() => (
    (window as Window & { __sliceAnnouncements?: string[] }).__sliceAnnouncements ?? []
  ))).toEqual([]);
  await page.evaluate(() => window.__vivarium2DSlice!.seek(9_201));
  await expect(page.getByRole("status")).toHaveText("The east shelter now stands complete.");
  const announcements = await page.evaluate(() => (
    (window as Window & { __sliceAnnouncements?: string[] }).__sliceAnnouncements ?? []
  ));
  expect(announcements).toEqual(["The east shelter now stands complete."]);
});

test("seek proves ordered shelter construction, collapse milestones, and one ruin commit", async ({ page }) => {
  await bootSlice(page, "shelter-build");
  await page.evaluate(() => {
    window.__sliceCanvasIdentity = document.querySelector<HTMLCanvasElement>(".slice2d__canvas")!;
    window.__vivarium2DSlice!.seek(3_000);
  });
  const approaching = await page.evaluate(() => window.__vivarium2DSlice!.actorState("agent_aster")!);
  expect(approaching.position).not.toEqual({ x: 80, y: 240 });
  expect((await page.evaluate(() => window.__vivarium2DSlice!.shelterState("shelter-east")!)).phase).toBe("absent");
  await expect(page.getByRole("button", { name: /East shelter/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Aster — human, walking/ })).toHaveCount(1);

  await page.evaluate(() => window.__vivarium2DSlice!.seek(5_999));
  const readyToBuild = await page.evaluate(() => ({
    actor: window.__vivarium2DSlice!.actorState("agent_aster")!,
    shelter: window.__vivarium2DSlice!.shelterState("shelter-east")!,
  }));
  expect(actorShelterDistance(readyToBuild.actor, readyToBuild.shelter)).toBeLessThanOrEqual(32.01);
  expect(readyToBuild.actor.facing).toBe("north");
  expect(readyToBuild.actor.channels).toMatchObject({ locomotion: "idle", action: "work" });
  expect((await page.evaluate(() => window.__vivarium2DSlice!.shelterState("shelter-east")!)).phase).toBe("absent");
  await page.evaluate(() => window.__vivarium2DSlice!.seek(6_577));
  await expect(page.getByRole("button", { name: "Aster — human, building the east shelter" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "East shelter — under construction" })).toHaveCount(1);
  await page.evaluate(() => window.__vivarium2DSlice!.seek(5_999));

  const buildSamples: Array<{ actor: ActorState; shelter: ShelterState }> = [];
  for (const delta of [2, 575, 640, 768, 576, 384, 256]) {
    await page.evaluate((milliseconds) => window.__vivarium2DSlice!.advanceBy(milliseconds), delta);
    buildSamples.push(await page.evaluate(() => ({
      actor: window.__vivarium2DSlice!.actorState("agent_aster")!,
      shelter: window.__vivarium2DSlice!.shelterState("shelter-east")!,
    })));
  }
  await page.evaluate(() => window.__vivarium2DSlice!.seek(9_201));
  await expect(page.getByRole("button", { name: "Aster — human, building the east shelter" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "East shelter — standing with a lit hearth" })).toHaveCount(1);
  const buildActorInstance = buildSamples[0]!.actor.instanceId;
  const buildShelterInstance = buildSamples[0]!.shelter.instanceId;
  expect(buildSamples.every(({ actor }) => actor.instanceId === buildActorInstance)).toBe(true);
  expect(buildSamples.every(({ shelter }) => shelter.instanceId === buildShelterInstance)).toBe(true);
  expect(buildSamples.every(({ actor, shelter }) => actorShelterDistance(actor, shelter) <= 32.01)).toBe(true);
  expect(buildSamples.every(({ actor }) => actor.facing === "north" && actor.channels.action === "work")).toBe(true);
  const buildOrder = ["foundation", "posts", "walls", "roof", "door", "hearth"] as const;
  for (const [sampleIndex, { shelter: sample }] of buildSamples.slice(0, 6).entries()) {
    for (const [componentIndex, id] of buildOrder.entries()) {
      expect(component(sample, id).visibility, `${id} at build sample ${sampleIndex}`).toBe(
        componentIndex <= sampleIndex ? 1 : 0,
      );
    }
  }
  const built = buildSamples.at(-1)!.shelter;
  expect(built.emittedMarkers.slice(0, 7)).toEqual([
    "foundation", "posts", "walls", "roof", "door", "hearth", "build-commit",
  ]);
  expect(built.phase).toBe("standing");
  expect(built.buildCommitCount).toBe(1);

  await page.evaluate(() => {
    window.__vivarium2DSlice!.setScene("full-loop");
    window.__vivarium2DSlice!.seek(6_499);
  });
  const fullLoopReady = await page.evaluate(() => ({
    actor: window.__vivarium2DSlice!.actorState("agent_aster")!,
    shelter: window.__vivarium2DSlice!.shelterState("shelter-east")!,
  }));
  expect(actorShelterDistance(fullLoopReady.actor, fullLoopReady.shelter)).toBeLessThanOrEqual(32.01);
  expect(fullLoopReady.actor).toMatchObject({ facing: "north", channels: { locomotion: "idle", action: "work" } });
  const fullLoopActorInstance = fullLoopReady.actor.instanceId;
  for (const delta of [2, 575, 640, 768, 576, 384, 256]) {
    await page.evaluate((milliseconds) => window.__vivarium2DSlice!.advanceBy(milliseconds), delta);
    const milestone = await page.evaluate(() => ({
      actor: window.__vivarium2DSlice!.actorState("agent_aster")!,
      shelter: window.__vivarium2DSlice!.shelterState("shelter-east")!,
    }));
    expect(milestone.actor.instanceId).toBe(fullLoopActorInstance);
    expect(actorShelterDistance(milestone.actor, milestone.shelter)).toBeLessThanOrEqual(32.01);
    expect(milestone.actor).toMatchObject({ facing: "north", channels: { locomotion: "idle", action: "work" } });
  }

  await page.evaluate(() => {
    window.__vivarium2DSlice!.setScene("shelter-collapse");
    window.__vivarium2DSlice!.seek(799);
  });
  const collapseSamples: ShelterState[] = [];
  for (const delta of [2, 431, 528, 528, 912]) {
    await page.evaluate((milliseconds) => window.__vivarium2DSlice!.advanceBy(milliseconds), delta);
    collapseSamples.push(await page.evaluate(() => window.__vivarium2DSlice!.shelterState("shelter-east")!));
  }
  expect(component(collapseSamples[0]!, "hearth")).toMatchObject({ visibility: 0, damaged: true });
  const collapseOrder = ["hearth", "roof", "walls", "door"] as const;
  for (const [sampleIndex, sample] of collapseSamples.slice(0, 4).entries()) {
    for (const [componentIndex, id] of collapseOrder.entries()) {
      expect(component(sample, id).damaged, `${id} at collapse sample ${sampleIndex}`).toBe(
        componentIndex <= sampleIndex,
      );
    }
  }
  const ruin = collapseSamples.at(-1)!;
  expect(ruin.phase).toBe("ruin");
  expect(ruin.collapseCommitCount).toBe(1);
  expect(ruin.components.every(({ visibility, damaged }) => visibility === 0 && damaged)).toBe(true);
  expect(ruin.emittedMarkers).toEqual(["hearth", "roof", "walls", "door", "collapse-commit"]);
  await page.evaluate(() => window.__vivarium2DSlice!.seek(3_201));
  await expect(page.getByRole("button", { name: "East shelter ruins — rubble remains" })).toHaveCount(1);
  await page.evaluate(() => window.__vivarium2DSlice!.advanceBy(5_000));
  expect((await page.evaluate(() => window.__vivarium2DSlice!.shelterState("shelter-east")!)).collapseCommitCount).toBe(1);
  expect(await page.evaluate(() => document.querySelector(".slice2d__canvas") === window.__sliceCanvasIdentity)).toBe(true);
});

test("desktop, tablet, short, and mobile layouts stay bounded with touch-sized controls", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900, crop: "desktop-full" },
    { width: 1024, height: 768, crop: "desktop-full" },
    { width: 1280, height: 600, crop: "desktop-full" },
    { width: 390, height: 844, crop: "mobile-crop" },
  ] as const) {
    await bootSlice(page, "full-loop", { viewport });
    const state = await page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>(".slice2d")!;
      const canvas = document.querySelector<HTMLCanvasElement>(".slice2d__canvas")!;
      const stageBounds = stage.getBoundingClientRect();
      const canvasBounds = canvas.getBoundingClientRect();
      const controls = Array.from(document.querySelectorAll<HTMLElement>(".slice2d button"))
        .map((node) => ({ label: node.textContent?.trim(), ...node.getBoundingClientRect().toJSON() }));
      const overlays = Array.from(document.querySelectorAll<HTMLElement>(
        ".slice2d__camera-controls, .slice2d__dialogue, .slice2d__semantic-mirror",
      )).map((node) => {
        const bounds = node.getBoundingClientRect();
        return {
          className: node.className,
          visibleWidth: Math.max(0, Math.min(innerWidth, bounds.right) - Math.max(0, bounds.left)),
          visibleHeight: Math.max(0, Math.min(innerHeight, bounds.bottom) - Math.max(0, bounds.top)),
        };
      });
      return {
        overflowX: document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth,
        overflowY: document.scrollingElement!.scrollHeight - document.scrollingElement!.clientHeight,
        stageHeight: stageBounds.height,
        visibleCanvasHeight: Math.max(0, Math.min(stageBounds.bottom, canvasBounds.bottom)
          - Math.max(stageBounds.top, canvasBounds.top)),
        visibleCanvasWidth: Math.max(0, Math.min(stageBounds.right, canvasBounds.right)
          - Math.max(stageBounds.left, canvasBounds.left)),
        controls,
        overlays,
        cropMode: window.__vivarium2DSlice!.renderDiagnostics().cropMode,
      };
    });
    expect(state.overflowX, `${viewport.width}x${viewport.height} horizontal overflow`).toBeLessThanOrEqual(1);
    expect(state.overflowY, `${viewport.width}x${viewport.height} vertical overflow`).toBeLessThanOrEqual(1);
    expect(state.controls.filter(({ width, height }) => width < 44 || height < 44)).toEqual([]);
    expect(state.controls.filter(({ left, top, right, bottom }) => (
      left < -1 || top < -1 || right > viewport.width + 1 || bottom > viewport.height + 1
    ))).toEqual([]);
    expect(state.overlays.filter(({ visibleWidth, visibleHeight }) => visibleWidth <= 0 || visibleHeight <= 0)).toEqual([]);
    expect(state.visibleCanvasWidth).toBeGreaterThan(0);
    expect(state.visibleCanvasHeight).toBeGreaterThan(0);
    expect(state.cropMode).toBe(viewport.crop);
    if (viewport.width === 390) {
      expect(state.stageHeight).toBeGreaterThanOrEqual(viewport.height * 0.52);
      expect(state.visibleCanvasHeight).toBeGreaterThanOrEqual(288);
    }
  }
});

test("keyboard order, focus, contrast, pressed meaning, and reduced-motion endpoints remain equivalent", async ({ page }) => {
  await bootSlice(page, "full-loop", { viewport: { width: 1440, height: 900 } });
  const order = await page.evaluate(() => Array.from(document.querySelectorAll(
    ".slice2d__canvas, .slice2d__camera-controls, .slice2d__dialogue, .slice2d__semantic-mirror, .slice2d__live-region",
  )).map((node) => node.className));
  expect(order).toEqual([
    "slice2d__canvas",
    "slice2d__camera-controls",
    "slice2d__dialogue",
    "slice2d__semantic-mirror",
    "slice2d__live-region",
  ]);

  const canvas = page.getByLabel("Animated Vivarium region");
  await canvas.focus();
  const focus = await canvas.evaluate((node) => {
    const style = getComputedStyle(node);
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
  });
  expect(focus.style).not.toBe("none");
  expect(focus.width).toBeGreaterThanOrEqual(3);

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Resume" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Restart" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(1_000);
  expect((await page.evaluate(() => window.__vivarium2DSlice!.actorState("agent_aster")!)).distanceTravelled).toBeGreaterThan(0);

  await canvas.focus();
  await page.keyboard.press("f");
  await expect(page.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("v");
  await expect(page.getByRole("button", { name: "Free" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("s");
  await expect(page.getByRole("button", { name: "Story" })).toHaveAttribute("aria-pressed", "true");

  const selectedMeaning = await page.getByRole("button", { name: "Story" }).evaluate((node) => {
    const style = getComputedStyle(node);
    return { pressed: node.getAttribute("aria-pressed"), inset: style.boxShadow.includes("inset") };
  });
  expect(selectedMeaning).toEqual({ pressed: "true", inset: true });

  const contrast = await page.evaluate(() => {
    type Rgb = { r: number; g: number; b: number; a: number };
    const parse = (value: string): Rgb => {
      const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return { r: channels[0] ?? 0, g: channels[1] ?? 0, b: channels[2] ?? 0, a: channels[3] ?? 1 };
    };
    const blend = (front: Rgb, back: Rgb): Rgb => ({
      r: front.r * front.a + back.r * (1 - front.a),
      g: front.g * front.a + back.g * (1 - front.a),
      b: front.b * front.a + back.b * (1 - front.a),
      a: 1,
    });
    const luminance = (color: Rgb): number => {
      const channel = (value: number): number => {
        const normalized = value / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    };
    const ratio = (front: Rgb, back: Rgb): number => {
      const high = Math.max(luminance(front), luminance(back));
      const low = Math.min(luminance(front), luminance(back));
      return (high + 0.05) / (low + 0.05);
    };
    const base = { r: 17, g: 26, b: 23, a: 1 };
    return [
      ["Story", ".slice2d__camera-controls button"],
      ["dialogue", ".slice2d__dialogue p"],
      ["entity", ".slice2d__semantic-mirror button"],
    ].map(([label, selector]) => {
      const text = document.querySelector<HTMLElement>(selector)!;
      const surface = text.closest<HTMLElement>("button, .slice2d__dialogue, .slice2d__semantic-mirror")!;
      const background = blend(parse(getComputedStyle(surface).backgroundColor), base);
      const foreground = blend(parse(getComputedStyle(text).color), background);
      return { label, ratio: ratio(foreground, background) };
    });
  });
  for (const sample of contrast) expect(sample.ratio, sample.label).toBeGreaterThanOrEqual(4.5);

  await page.evaluate(() => {
    window.__vivarium2DSlice!.pause();
    window.__vivarium2DSlice!.setScene("shelter-collapse");
    window.__vivarium2DSlice!.seek(100);
  });
  await page.getByRole("button", { name: /East shelter/ }).click();
  const normalIntermediate = await page.evaluate(() => {
    window.__vivarium2DSlice!.advanceBy(50);
    return {
      camera: window.__vivarium2DSlice!.cameraState(),
      activeAnimations: window.__vivarium2DSlice!.renderDiagnostics().activeAnimations,
    };
  });
  const normalEndpoint = await page.evaluate(() => {
    window.__vivarium2DSlice!.setScene("full-loop");
    window.__vivarium2DSlice!.seek(16_000);
    return {
      actor: window.__vivarium2DSlice!.actorState("agent_aster"),
      shelter: window.__vivarium2DSlice!.shelterState("shelter-east"),
      camera: window.__vivarium2DSlice!.cameraState(),
    };
  });
  await bootSlice(page, "full-loop", { reducedMotion: "reduce" });
  await page.evaluate(() => {
    window.__vivarium2DSlice!.setScene("shelter-collapse");
    window.__vivarium2DSlice!.seek(100);
  });
  await page.getByRole("button", { name: /East shelter/ }).click();
  const reducedIntermediate = await page.evaluate(() => {
    window.__vivarium2DSlice!.advanceBy(50);
    return {
      camera: window.__vivarium2DSlice!.cameraState(),
      activeAnimations: window.__vivarium2DSlice!.renderDiagnostics().activeAnimations,
    };
  });
  const reducedEndpoint = await page.evaluate(() => {
    window.__vivarium2DSlice!.setScene("full-loop");
    window.__vivarium2DSlice!.seek(16_000);
    return {
      actor: window.__vivarium2DSlice!.actorState("agent_aster"),
      shelter: window.__vivarium2DSlice!.shelterState("shelter-east"),
      camera: window.__vivarium2DSlice!.cameraState(),
      cssDuration: getComputedStyle(document.querySelector(".slice2d")!).transitionDuration,
    };
  });
  expect(normalIntermediate.activeAnimations).toBeGreaterThan(reducedIntermediate.activeAnimations);
  expect(normalIntermediate.camera.center).not.toEqual(reducedIntermediate.camera.center);
  expect(reducedEndpoint.actor?.position).toEqual(normalEndpoint.actor?.position);
  expect(reducedEndpoint.actor?.distanceTravelled).toBe(normalEndpoint.actor?.distanceTravelled);
  expect(reducedEndpoint.shelter?.phase).toBe(normalEndpoint.shelter?.phase);
  expect(reducedEndpoint.shelter?.collapseCommitCount).toBe(normalEndpoint.shelter?.collapseCommitCount);
  expect(reducedEndpoint.camera.center.x).toBeCloseTo(normalEndpoint.camera.center.x, 4);
  expect(reducedEndpoint.camera.center.y).toBeCloseTo(normalEndpoint.camera.center.y, 4);
  expect(Number.parseFloat(reducedEndpoint.cssDuration)).toBeLessThanOrEqual(0.001);
});

type ManifestRecord = {
  file: string;
  src?: string;
  imports?: string[];
  dynamicImports?: string[];
};

function resolveStaticModule(importer: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(importer), specifier);
  const candidates = extname(base)
    ? [base]
    : [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function sourceStaticClosure(root: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file) || !/\.(?:[cm]?[jt]sx?|css)$/.test(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    const imports = source.matchAll(
      /(?:^|\n)\s*(?:import\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?|export\s+(?:type\s+)?[^"']*?\s+from\s+)["']([^"']+)["']/g,
    );
    for (const match of imports) {
      const resolved = resolveStaticModule(file, match[1]!);
      if (resolved) visit(resolved);
    }
  };
  visit(root);
  return [...seen].sort();
}

test("CanvasWorldStage static closure and browser requests exclude Three and WorldRenderer", async ({ page }) => {
  execFileSync("npm", ["--prefix", "frontend", "run", "build"], { cwd: ROOT, stdio: "pipe" });
  const manifestPath = resolve(ROOT, "frontend/dist/.vite/manifest.json");
  expect(existsSync(manifestPath), "Vite build manifest").toBe(true);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, ManifestRecord>;
  const stageEntry = Object.entries(manifest).find(([key, record]) => (
    key.endsWith("src/renderer2d/CanvasWorldStage.tsx") || record.src === "src/renderer2d/CanvasWorldStage.tsx"
  ));
  expect(stageEntry, "CanvasWorldStage manifest record").toBeDefined();

  const manifestClosure = new Set<string>();
  const visitManifest = (key: string): void => {
    if (manifestClosure.has(key)) return;
    manifestClosure.add(key);
    for (const imported of manifest[key]?.imports ?? []) visitManifest(imported);
  };
  visitManifest(stageEntry![0]);
  const manifestEvidence = [...manifestClosure].flatMap((key) => {
    const record = manifest[key];
    return [key, record?.src ?? "", record?.file ?? ""];
  });
  expect(manifestEvidence.filter((value) => (
    /LivingAtlasApp|WorldRenderer|(?:^|[/_-])three(?:[/_.-]|$)|src\/renderer\//i.test(value)
  ))).toEqual([]);

  const sourceClosure = sourceStaticClosure(STAGE_SOURCE);
  expect(sourceClosure.some((file) => file.endsWith("CanvasWorldRenderer.ts"))).toBe(true);
  expect(sourceClosure.filter((file) => file.includes("/frontend/src/renderer/"))).toEqual([]);
  expect(sourceClosure.filter((file) => file.endsWith("/frontend/src/app/LivingAtlasApp.tsx"))).toEqual([]);
  for (const file of sourceClosure) {
    expect(readFileSync(file, "utf8"), file).not.toMatch(
      /(?:from\s+|import\s*(?:\(\s*)?)["']three(?:\/[^"']*)?["']/,
    );
  }
  let rgOutput = "";
  try {
    rgOutput = execFileSync("rg", [
      "-n",
      "(?:from\\s+|import\\s*(?:\\(\\s*)?)[\"']three",
      "frontend/src/renderer2d",
    ], {
      cwd: ROOT,
      encoding: "utf8",
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status !== 1) throw error;
  }
  expect(rgOutput).toBe("");

  const scriptResponses: string[] = [];
  page.on("response", (response) => {
    const type = response.request().resourceType();
    if (type === "script") scriptResponses.push(response.url());
  });
  let shelterAtlasAttempts = 0;
  let failShelterAtlas = true;
  const requestedUrls: string[] = [];
  page.on("request", (request) => requestedUrls.push(request.url()));
  await page.route("**/*", async (route) => {
    if (!route.request().url().includes("shelter-slice-atlas")) {
      await route.continue();
      return;
    }
    shelterAtlasAttempts += 1;
    if (failShelterAtlas) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.goto("/?renderer=2d-slice&scene=walk");
  await page.waitForTimeout(500);
  expect(shelterAtlasAttempts, requestedUrls.join("\n")).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.__sliceCanvasIdentity = document.querySelector<HTMLCanvasElement>(".slice2d__canvas")!;
  });
  const retry = page.getByRole("button", { name: "Retry world" });
  await expect(page.getByRole("alert")).toContainText("World unavailable");
  await expect(page.getByRole("alert")).toContainText("shelter");
  await expect(retry).toBeFocused();
  await page.evaluate(() => {
    (window as Window & { __failedSliceDebug?: unknown }).__failedSliceDebug = window.__vivarium2DSlice;
  });
  failShelterAtlas = false;
  await retry.click();
  await page.waitForFunction(() => window.__vivarium2DSlice?.isReady() === true);
  await expect(page.getByTestId("vivarium-2d-slice")).toHaveAttribute("data-ready", "true");
  await expect(page.getByLabel("Animated Vivarium region")).toBeFocused();
  expect(shelterAtlasAttempts).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => document.querySelector(".slice2d__canvas") === window.__sliceCanvasIdentity)).toBe(true);
  expect(await page.evaluate(() => (
    (window as Window & { __failedSliceDebug?: unknown }).__failedSliceDebug !== window.__vivarium2DSlice
  ))).toBe(true);
  const known3DFiles = Object.values(manifest)
    .filter((record) => (
      /(?:^|\/)src\/renderer\/|src\/app\/LivingAtlasApp|WorldRenderer|(?:^|[/_-])three(?:[/_.-]|$)/i
        .test(`${record.src ?? ""} ${record.file}`)
    ))
    .map((record) => record.file.split("/").at(-1)!);
  const isForbidden3DUrl = (url: string): boolean => (
    /\/src\/renderer\/|\/src\/app\/LivingAtlasApp|node_modules\/@?three|\/three\//i.test(url)
    || known3DFiles.some((file) => url.includes(file))
  );
  expect(scriptResponses.filter(isForbidden3DUrl)).toEqual([]);
  expect(requestedUrls.filter(isForbidden3DUrl)).toEqual([]);
  const preloadUrls = await page.locator('link[rel~="preload"], link[rel="modulepreload"]').evaluateAll((links) => (
    links.map((link) => (link as HTMLLinkElement).href)
  ));
  expect(preloadUrls.filter(isForbidden3DUrl)).toEqual([]);
  const resourceUrls = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
  expect(resourceUrls.filter(isForbidden3DUrl)).toEqual([]);
});
