import { writeFile } from "node:fs/promises";

import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

const ROUTE = "/character-pilot.html";
const EXPECTED_HOST = `127.0.0.1:${
  process.env.VIVARIUM_FRONTEND_APP_PORT ?? "5174"
}`;
const ACTOR_ID = "character-pilot-balanced-male";
const LAYER_IDS = ["body", "clothing", "face", "hair", "held", "status"] as const;

type PilotMilestone =
  | "front-idle"
  | "east-mid-walk"
  | "reach-contact"
  | "prone";

interface PilotLayerSnapshot {
  readonly clipId: string;
  readonly frameIndex: number;
  readonly facing: string;
  readonly fallback: boolean;
}

interface PilotBrowserSnapshot {
  readonly beat: string;
  readonly elapsedMs: number;
  readonly lastMarker: string | null;
  readonly actor: Readonly<{
    readonly id: string;
    readonly instanceId: number;
    readonly position: Readonly<{ readonly x: number; readonly y: number }>;
    readonly facing: string;
    readonly activeAction: string | null;
    readonly artFallback: string | null;
    readonly layers: Readonly<Record<string, PilotLayerSnapshot>>;
  }>;
}

interface PilotBridge {
  seek(milestone: PilotMilestone): Promise<void>;
  snapshot(): PilotBrowserSnapshot;
}

interface MilestoneExpectation {
  readonly milestone: PilotMilestone;
  readonly fileName: `${PilotMilestone}.png`;
  readonly beat: string;
  readonly facing: string;
  readonly activeAction: string | null;
  readonly lastMarker: string | null;
  readonly position: Readonly<{ readonly x: number; readonly y: number }>;
  readonly body: Readonly<{ readonly clipId: string; readonly frameIndex: number }>;
  readonly faceClipId: string;
  readonly heldClipId: string;
  readonly statusClipId: string;
}

const MILESTONES: readonly MilestoneExpectation[] = Object.freeze([
  Object.freeze({
    milestone: "front-idle",
    fileName: "front-idle.png",
    beat: "idle",
    facing: "south",
    activeAction: null,
    lastMarker: null,
    position: Object.freeze({ x: 226, y: 102 }),
    body: Object.freeze({ clipId: "human-a:idle:south", frameIndex: 0 }),
    faceClipId: "human-a:south:neutral",
    heldClipId: "none:south",
    statusClipId: "alive:south",
  }),
  Object.freeze({
    milestone: "east-mid-walk",
    fileName: "east-mid-walk.png",
    beat: "walk",
    facing: "east",
    activeAction: "moving",
    lastMarker: "foot-contact",
    position: Object.freeze({ x: 256, y: 150 }),
    body: Object.freeze({ clipId: "human-a:walk:east", frameIndex: 3 }),
    faceClipId: "human-a:east:neutral",
    heldClipId: "none:east",
    statusClipId: "alive:east",
  }),
  Object.freeze({
    milestone: "reach-contact",
    fileName: "reach-contact.png",
    beat: "reach",
    facing: "south",
    activeAction: "reaching",
    lastMarker: "hand-contact",
    position: Object.freeze({ x: 226, y: 102 }),
    body: Object.freeze({ clipId: "human-a:reach-give:south", frameIndex: 3 }),
    faceClipId: "human-a:south:neutral",
    heldClipId: "resource-handful:south",
    statusClipId: "alive:south",
  }),
  Object.freeze({
    milestone: "prone",
    fileName: "prone.png",
    beat: "prone",
    facing: "south",
    activeAction: "prone",
    lastMarker: "fall-contact",
    position: Object.freeze({ x: 226, y: 102 }),
    body: Object.freeze({ clipId: "human-a:prone:south", frameIndex: 0 }),
    faceClipId: "human-a:south:hurt",
    heldClipId: "none:south",
    statusClipId: "paralyzed:south",
  }),
]);

test.use({ viewport: { width: 1280, height: 800 } });

test("renders four exact review milestones on one native-pixel actor without external traffic", async ({
  page,
}, testInfo) => {
  const browserIssues = observeBrowserIssues(page);

  await page.goto(ROUTE);

  const canvas = page.getByRole("img", {
    name: "Animated character movement pilot",
  });
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect(canvas).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.waitForFunction(() => (
    "__VIVARIUM_CHARACTER_PILOT__" in window
  ));

  const raster = await canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) {
      throw new TypeError("Character pilot proof requires a Canvas.");
    }
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      backingWidth: element.width,
      backingHeight: element.height,
      computedWidth: style.width,
      rectWidth: rect.width,
      rectHeight: rect.height,
      scaleX: rect.width / element.width,
      scaleY: rect.height / element.height,
      imageRendering: style.imageRendering,
    };
  });
  expect(raster).toEqual({
    backingWidth: 512,
    backingHeight: 288,
    computedWidth: "1024px",
    rectWidth: 1024,
    rectHeight: 576,
    scaleX: 2,
    scaleY: 2,
    imageRendering: "pixelated",
  });

  const snapshots: PilotBrowserSnapshot[] = [];
  for (const expected of MILESTONES) {
    const snapshot = await seekAndSnapshot(page, expected.milestone);
    snapshots.push(snapshot);

    expect(snapshot).toMatchObject({
      beat: expected.beat,
      lastMarker: expected.lastMarker,
      actor: {
        id: ACTOR_ID,
        position: expected.position,
        facing: expected.facing,
        activeAction: expected.activeAction,
        artFallback: null,
      },
    });
    expect(Object.keys(snapshot.actor.layers).sort()).toEqual([...LAYER_IDS].sort());
    expect(new Set(
      Object.values(snapshot.actor.layers).map(({ facing }) => facing),
    )).toEqual(new Set([expected.facing]));
    expect(Object.values(snapshot.actor.layers).every(({ fallback }) => !fallback))
      .toBe(true);
    expect(snapshot.actor.layers.body).toMatchObject(expected.body);
    expect(snapshot.actor.layers.face?.clipId).toBe(expected.faceClipId);
    expect(snapshot.actor.layers.held?.clipId).toBe(expected.heldClipId);
    expect(snapshot.actor.layers.status?.clipId).toBe(expected.statusClipId);
    await bufferCanvasFrame(canvas);
  }

  expect(new Set(snapshots.map(({ actor }) => actor.id))).toEqual(new Set([ACTOR_ID]));
  expect(new Set(snapshots.map(({ actor }) => actor.instanceId)).size).toBe(1);
  expect(snapshots[0]?.actor.instanceId).toBeGreaterThan(0);
  expect(browserIssues).toEqual([]);

  const encodedFrames = await encodeBufferedFrames(page);
  expect(encodedFrames).toHaveLength(4);
  for (const [index, expected] of MILESTONES.entries()) {
    const encoded = encodedFrames[index];
    if (encoded === undefined) throw new Error(`Missing PNG for ${expected.milestone}.`);
    const imagePath = testInfo.outputPath(expected.fileName);
    await writeFile(imagePath, Buffer.from(encoded, "base64"));
    await attachPng(testInfo, expected.milestone, imagePath);
  }
});

async function seekAndSnapshot(
  page: Page,
  milestone: PilotMilestone,
): Promise<PilotBrowserSnapshot> {
  return page.evaluate(async (requestedMilestone) => {
    const bridge = (
      window as Window & { __VIVARIUM_CHARACTER_PILOT__?: PilotBridge }
    ).__VIVARIUM_CHARACTER_PILOT__;
    if (bridge === undefined) throw new Error("Character pilot bridge is unavailable.");
    await bridge.seek(requestedMilestone);
    return bridge.snapshot();
  }, milestone);
}

function observeBrowserIssues(page: Page): string[] {
  const issues: string[] = [];
  page.on("pageerror", (error) => {
    issues.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      const source = location.url === ""
        ? ""
        : ` @ ${location.url}:${location.lineNumber}:${location.columnNumber}`;
      issues.push(`console: ${message.text()}${source}`);
    }
  });
  page.on("requestfailed", (request) => {
    issues.push(
      `requestfailed: ${request.method()} ${request.url()} `
      + `${request.failure()?.errorText ?? "unknown failure"}`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      issues.push(`response: ${response.status()} ${response.url()}`);
    }
  });
  page.on("request", (request) => {
    const issue = forbiddenTrafficIssue(request.url());
    if (issue !== null) issues.push(`request: ${issue}`);
  });
  page.on("websocket", (socket) => {
    const issue = forbiddenTrafficIssue(socket.url());
    if (issue !== null) issues.push(`websocket: ${issue}`);
  });
  return issues;
}

function forbiddenTrafficIssue(rawUrl: string): string | null {
  const url = new URL(rawUrl);
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return null;

  const lowerUrl = rawUrl.toLowerCase();
  const isProvider = [
    "11434",
    ":8000",
    "ollama",
    "gemini",
    "generativelanguage.googleapis.com",
    "openai",
    "anthropic",
  ].some((needle) => lowerUrl.includes(needle));
  const isApi = /^\/(?:api|v1|events|event-stream|stream)(?:\/|$)/i.test(url.pathname);
  if (url.host !== EXPECTED_HOST || isApi || isProvider) {
    return `${rawUrl} (cross-origin=${url.host !== EXPECTED_HOST}, `
      + `api=${isApi}, provider=${isProvider})`;
  }
  return null;
}

async function bufferCanvasFrame(
  canvas: Locator,
): Promise<void> {
  await canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) {
      throw new TypeError("Character pilot proof requires a Canvas.");
    }
    const context = element.getContext("2d");
    if (context === null) throw new Error("Character pilot Canvas has no 2D context.");
    const testWindow = window as Window & {
      __VIVARIUM_CHARACTER_PILOT_FRAME_BUFFER__?: ImageData[];
    };
    const frames = testWindow.__VIVARIUM_CHARACTER_PILOT_FRAME_BUFFER__ ?? [];
    frames.push(context.getImageData(0, 0, element.width, element.height));
    testWindow.__VIVARIUM_CHARACTER_PILOT_FRAME_BUFFER__ = frames;
  });
}

async function encodeBufferedFrames(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const testWindow = window as Window & {
      __VIVARIUM_CHARACTER_PILOT_FRAME_BUFFER__?: ImageData[];
    };
    const frames = testWindow.__VIVARIUM_CHARACTER_PILOT_FRAME_BUFFER__ ?? [];
    const encoded = frames.map((frame) => {
      const canvas = document.createElement("canvas");
      canvas.width = frame.width;
      canvas.height = frame.height;
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("Evidence Canvas has no 2D context.");
      context.putImageData(frame, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      const separator = dataUrl.indexOf(",");
      if (separator < 0) throw new Error("Evidence Canvas returned an invalid PNG.");
      return dataUrl.slice(separator + 1);
    });
    delete testWindow.__VIVARIUM_CHARACTER_PILOT_FRAME_BUFFER__;
    return encoded;
  });
}

async function attachPng(
  testInfo: TestInfo,
  name: PilotMilestone,
  path: string,
): Promise<void> {
  await testInfo.attach(name, {
    path,
    contentType: "image/png",
  });
}
