import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import type { LayeredHumanActor } from "../../renderer2d/production/actors/LayeredHumanActor";
import type { CharacterPilotBundle } from "./pilotManifest";
import type {
  CharacterPilotTimeline,
  PilotFrame,
  PilotMilestone,
} from "./PilotTimeline";

const pilotHarness = vi.hoisted(() => ({
  acquire: vi.fn(),
  timelines: [] as CharacterPilotTimeline[],
  failTimelineConstruction: null as Error | null,
}));

vi.mock("./pilotManifest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./pilotManifest")>()),
  acquireCharacterPilotBundle: pilotHarness.acquire,
}));

vi.mock("./PilotTimeline", async (importOriginal) => {
  const original = await importOriginal<typeof import("./PilotTimeline")>();
  return {
    ...original,
    createCharacterPilotTimeline(actor: LayeredHumanActor): CharacterPilotTimeline {
      if (pilotHarness.failTimelineConstruction !== null) {
        throw pilotHarness.failTimelineConstruction;
      }
      const timeline = original.createCharacterPilotTimeline(actor);
      vi.spyOn(timeline, "advance");
      vi.spyOn(timeline, "seek");
      vi.spyOn(timeline, "dispose");
      pilotHarness.timelines.push(timeline);
      return timeline;
    },
  };
});

import { LayeredHumanActor as ProductionLayeredHumanActor } from
  "../../renderer2d/production/actors/LayeredHumanActor";
import {
  CHARACTER_PILOT_MANIFEST,
  type CharacterPilotBundle as RuntimeCharacterPilotBundle,
} from "./pilotManifest";
import {
  CharacterPilotStage,
  type PilotFrameDriver,
} from "./CharacterPilotStage";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

interface CanvasOperation {
  readonly kind:
    | "clearRect"
    | "fillRect"
    | "strokeRect"
    | "drawImage"
    | "fillText";
  readonly args: readonly unknown[];
  readonly smoothing: boolean;
  readonly fillStyle: string | CanvasGradient | CanvasPattern;
  readonly strokeStyle: string | CanvasGradient | CanvasPattern;
  readonly textAlign: CanvasTextAlign;
}

interface RecordedCanvas {
  readonly context: CanvasRenderingContext2D;
  readonly operations: CanvasOperation[];
}

class ManualFrameDriver implements PilotFrameDriver {
  readonly request = vi.fn((callback: FrameRequestCallback): number => {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.callbacks.set(handle, callback);
    return handle;
  });

  readonly cancel = vi.fn((handle: number): void => {
    this.callbacks.delete(handle);
  });

  readonly now = vi.fn((): number => this.time);

  private nextHandle = 1;
  private time = 0;
  private readonly callbacks = new Map<number, FrameRequestCallback>();

  get pendingCount(): number {
    return this.callbacks.size;
  }

  fire(timestamp: number): void {
    const entry = this.callbacks.entries().next().value as
      | readonly [number, FrameRequestCallback]
      | undefined;
    if (entry === undefined) throw new Error("No pilot frame is pending.");
    const [handle, callback] = entry;
    this.callbacks.delete(handle);
    this.time = timestamp;
    callback(timestamp);
  }
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function createBundle(label = "bundle"): RuntimeCharacterPilotBundle & {
  readonly release: Mock<() => void>;
} {
  const atlasIds = new Set([
    ...Object.values(CHARACTER_PILOT_MANIFEST.human.layerAtlases),
    CHARACTER_PILOT_MANIFEST.human.clothingAtlasBySilhouette["work-shirt-sash"]!,
  ]);
  const leases = new Map([...atlasIds].map((atlasId) => [
    atlasId,
    Object.freeze({
      value: Object.freeze({ atlasId, label }) as unknown as ImageBitmap,
      release(): void {},
    }),
  ]));
  return {
    manifest: CHARACTER_PILOT_MANIFEST,
    leases,
    release: vi.fn<() => void>(),
  };
}

function recordedCanvas(drawFailure: Error | null = null): RecordedCanvas {
  const operations: CanvasOperation[] = [];
  let smoothing = true;
  let filter = "none";
  let globalAlpha = 1;
  let globalCompositeOperation: GlobalCompositeOperation = "source-over";
  let fillStyle: string | CanvasGradient | CanvasPattern = "#000";
  let strokeStyle: string | CanvasGradient | CanvasPattern = "#000";
  let font = "10px sans-serif";
  let textAlign: CanvasTextAlign = "start";
  let textBaseline: CanvasTextBaseline = "alphabetic";
  const record = (
    kind: CanvasOperation["kind"],
    args: readonly unknown[],
  ): void => {
    operations.push({
      kind,
      args: [...args],
      smoothing,
      fillStyle,
      strokeStyle,
      textAlign,
    });
  };
  const context = {
    get imageSmoothingEnabled() {
      return smoothing;
    },
    set imageSmoothingEnabled(value: boolean) {
      smoothing = value;
    },
    get filter() {
      return filter;
    },
    set filter(value: string) {
      filter = value;
    },
    get globalAlpha() {
      return globalAlpha;
    },
    set globalAlpha(value: number) {
      globalAlpha = value;
    },
    get globalCompositeOperation() {
      return globalCompositeOperation;
    },
    set globalCompositeOperation(value: GlobalCompositeOperation) {
      globalCompositeOperation = value;
    },
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      fillStyle = value;
    },
    get strokeStyle() {
      return strokeStyle;
    },
    set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
      strokeStyle = value;
    },
    get font() {
      return font;
    },
    set font(value: string) {
      font = value;
    },
    get textAlign() {
      return textAlign;
    },
    set textAlign(value: CanvasTextAlign) {
      textAlign = value;
    },
    get textBaseline() {
      return textBaseline;
    },
    set textBaseline(value: CanvasTextBaseline) {
      textBaseline = value;
    },
    save(): void {},
    restore(): void {},
    clearRect(...args: readonly number[]): void {
      record("clearRect", args);
    },
    fillRect(...args: readonly number[]): void {
      record("fillRect", args);
    },
    strokeRect(...args: readonly number[]): void {
      record("strokeRect", args);
    },
    drawImage(...args: readonly unknown[]): void {
      if (drawFailure !== null) throw drawFailure;
      record("drawImage", args);
    },
    fillText(...args: readonly [string, number, number]): void {
      record("fillText", args);
    },
  } as unknown as CanvasRenderingContext2D;
  return { context, operations };
}

function expectPlaquePaint(
  operations: readonly CanvasOperation[],
  primary: string,
  secondary: string,
): void {
  let lastSpriteIndex = -1;
  for (let index = operations.length - 1; index >= 0; index -= 1) {
    if (operations[index]?.kind !== "drawImage") continue;
    lastSpriteIndex = index;
    break;
  }
  expect(lastSpriteIndex).toBeGreaterThanOrEqual(0);
  const plaque = operations.slice(lastSpriteIndex + 1);
  expect(plaque.map(({ kind }) => kind)).toEqual([
    "fillRect",
    "strokeRect",
    "fillText",
    "fillText",
  ]);

  const [panel, border, primaryText, secondaryText] = plaque;
  const [panelX, panelY, panelWidth, panelHeight] =
    panel!.args as readonly number[];
  const [borderX, , borderWidth] = border!.args as readonly number[];
  expect(panelX! + panelWidth! / 2).toBe(256);
  expect(panelY! + panelHeight!).toBeLessThan(41);
  expect(borderX! + borderWidth! / 2).toBe(256);
  expect(primaryText?.args[0]).toBe(primary);
  expect(secondaryText?.args[0]).toBe(secondary);
  for (const text of [primaryText, secondaryText]) {
    expect(text?.args[1]).toBe(256);
    expect(Number.isInteger(text?.args[2])).toBe(true);
    expect(text?.textAlign).toBe("center");
  }
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Missing ${label} button.`);
  }
  return match;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function seek(
  bridge: NonNullable<Window["__VIVARIUM_CHARACTER_PILOT__"]>,
  milestone: PilotMilestone,
): Promise<void> {
  await act(async () => {
    await bridge.seek(milestone);
  });
}

function expectFocusedFailure(container: HTMLElement, privateText: string): void {
  const alerts = container.querySelectorAll<HTMLElement>("[role='alert']");
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.textContent).toBe("The character pilot could not be started.");
  expect(alerts[0]?.textContent).not.toContain(privateText);
  expect(document.activeElement).toBe(alerts[0]);
  expect(window.__VIVARIUM_CHARACTER_PILOT__).toBeUndefined();
}

let container: HTMLDivElement;
let root: Root | null;
let driver: ManualFrameDriver;
let canvas: RecordedCanvas;
let contextSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  delete window.__VIVARIUM_CHARACTER_PILOT__;
  pilotHarness.acquire.mockReset();
  pilotHarness.timelines.length = 0;
  pilotHarness.failTimelineConstruction = null;
  driver = new ManualFrameDriver();
  canvas = recordedCanvas();
  contextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(canvas.context);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  contextSpy.mockRestore();
  container.remove();
  delete window.__VIVARIUM_CHARACTER_PILOT__;
  vi.restoreAllMocks();
});

describe("CharacterPilotStage", () => {
  it("renders one isolated accessible 512x288 surface while loading", async () => {
    pilotHarness.acquire.mockReturnValue(deferred<CharacterPilotBundle>().promise);

    await act(async () => root?.render(<CharacterPilotStage frameDriver={driver} />));

    expect(container.firstElementChild?.tagName).toBe("DIV");
    expect(container.querySelectorAll("main")).toHaveLength(0);
    const canvases = container.querySelectorAll("canvas");
    expect(canvases).toHaveLength(1);
    expect(canvases[0]).toMatchObject({ width: 512, height: 288 });
    expect(canvases[0]?.getAttribute("role")).toBe("img");
    expect(canvases[0]?.getAttribute("aria-label")).toBe(
      "Animated character movement pilot",
    );
    expect(canvases[0]?.getAttribute("aria-describedby")).toContain(
      "character-pilot-instructions",
    );
    expect(button(container, "Pause").disabled).toBe(true);
    expect(button(container, "Restart").disabled).toBe(true);
    const visiblePresentation = container.querySelector(
      ".character-pilot__beat",
    );
    expect(visiblePresentation?.tagName).toBe("SPAN");
    expect(visiblePresentation?.textContent).toBe("1 / 6 · Standing idle");
    expect(container.querySelectorAll("output")).toHaveLength(0);
    const statuses = container.querySelectorAll<HTMLElement>("[role='status']");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.getAttribute("aria-live")).toBe("polite");
    expect(statuses[0]?.getAttribute("aria-atomic")).toBe("true");
    expect(statuses[0]?.textContent).toBe(
      "Beat 1 of 6. Standing idle. Facing forward.",
    );
    const politeAnnouncements = container.querySelectorAll<HTMLElement>(
      "[aria-live='polite']",
    );
    expect(politeAnnouncements).toHaveLength(1);
    expect(politeAnnouncements[0]).toBe(statuses[0]);
    expect(container.textContent).not.toMatch(
      /Chronicle|Selection|Archive|observer|population|region panel/i,
    );
    expect(window.__VIVARIUM_CHARACTER_PILOT__).toBeUndefined();
  });

  it("paints the first real actor frame before publishing its immutable bridge", async () => {
    const pending = deferred<CharacterPilotBundle>();
    const bundle = createBundle();
    pilotHarness.acquire.mockReturnValue(pending.promise);
    await act(async () => root?.render(<CharacterPilotStage frameDriver={driver} />));
    expect(window.__VIVARIUM_CHARACTER_PILOT__).toBeUndefined();
    expect(canvas.operations).toEqual([]);

    pending.resolve(bundle);
    await settle();

    const signal = pilotHarness.acquire.mock.calls[0]?.[0] as AbortSignal;
    expect(signal.aborted).toBe(false);
    expect(contextSpy).toHaveBeenCalledWith("2d");
    const markerOperations = canvas.operations.filter(({ kind, args }) =>
      kind === "fillRect" && args.join(",") === "242,89,20,12");
    expect(markerOperations).toHaveLength(1);
    const markerIndex = canvas.operations.indexOf(markerOperations[0]!);
    const firstSpriteIndex = canvas.operations.findIndex(({ kind }) => kind === "drawImage");
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    expect(firstSpriteIndex).toBeGreaterThan(markerIndex);
    const spriteDraws = canvas.operations.filter(({ kind }) => kind === "drawImage");
    expect(spriteDraws.map(({ args }) => (
      args[0] as unknown as { atlasId: string }
    ).atlasId)).toEqual([
      "core-human-body-rigs",
      "core-human-clothing-00",
      "core-human-face-planes",
      "core-human-hair",
    ]);
    for (const draw of spriteDraws) {
      expect(draw.smoothing).toBe(false);
      expect(draw.args.slice(5, 9).every(Number.isInteger)).toBe(true);
    }
    for (const operation of canvas.operations.filter(({ kind }) => kind !== "drawImage")) {
      const coordinates = operation.kind === "fillText"
        ? operation.args.slice(1)
        : operation.args;
      expect(coordinates.every(Number.isInteger)).toBe(true);
    }
    expectPlaquePaint(
      canvas.operations,
      "1 / 6 · Standing idle",
      "Facing forward",
    );
    expect(canvas.operations[0]).toMatchObject({
      kind: "clearRect",
      smoothing: false,
    });
    expect(canvas.context.imageSmoothingEnabled).toBe(false);
    const bridge = window.__VIVARIUM_CHARACTER_PILOT__;
    expect(bridge).toBeDefined();
    expect(Object.isFrozen(bridge)).toBe(true);
    expect(bridge?.snapshot()).toMatchObject({
      beat: "idle",
      elapsedMs: 0,
      actor: { facing: "south", artFallback: null },
    });
    expect(Object.isFrozen(bridge?.snapshot())).toBe(true);
    expect(Object.getOwnPropertyDescriptor(
      window,
      "__VIVARIUM_CHARACTER_PILOT__",
    )).toMatchObject({
      configurable: true,
      enumerable: false,
      writable: false,
      value: bridge,
    });
    expect(driver.pendingCount).toBe(1);
    expect(button(container, "Pause").disabled).toBe(false);
    expect(button(container, "Restart").disabled).toBe(false);
  });

  it("admits one raw RAF delta and relies on the timeline's 120ms ceiling", async () => {
    pilotHarness.acquire.mockResolvedValue(createBundle());
    await act(async () => root?.render(<CharacterPilotStage frameDriver={driver} />));
    await settle();
    const timeline = pilotHarness.timelines[0]!;
    const advance = vi.mocked(timeline.advance);

    await act(async () => driver.fire(100));
    expect(advance).toHaveBeenLastCalledWith(0, 100);
    expect(driver.pendingCount).toBe(1);

    await act(async () => driver.fire(1_100));
    expect(advance).toHaveBeenLastCalledWith(1, 1_100);
    expect(advance).toHaveBeenCalledTimes(2);
    expect(window.__VIVARIUM_CHARACTER_PILOT__?.snapshot().elapsedMs).toBe(120);
    expect(driver.pendingCount).toBe(1);
  });

  it("pauses synchronously and resumes with a zero-delta first callback", async () => {
    pilotHarness.acquire.mockResolvedValue(createBundle());
    await act(async () => root?.render(<CharacterPilotStage frameDriver={driver} />));
    await settle();
    const timeline = pilotHarness.timelines[0]!;
    const advance = vi.mocked(timeline.advance);

    await act(async () => driver.fire(100));
    await click(button(container, "Pause"));
    expect(driver.pendingCount).toBe(0);
    expect(button(container, "Play").disabled).toBe(false);
    expect(driver.cancel).toHaveBeenCalledOnce();

    await click(button(container, "Play"));
    expect(driver.pendingCount).toBe(1);
    await act(async () => driver.fire(5_000));
    expect(advance).toHaveBeenLastCalledWith(0, 5_000);
    await act(async () => driver.fire(6_000));
    expect(advance).toHaveBeenLastCalledWith(1, 6_000);
    expect(window.__VIVARIUM_CHARACTER_PILOT__?.snapshot().elapsedMs).toBe(120);
  });

  it("seeks synchronously to all four review milestones and keeps the page paused", async () => {
    pilotHarness.acquire.mockResolvedValue(createBundle());
    await act(async () => root?.render(<CharacterPilotStage frameDriver={driver} />));
    await settle();
    const bridge = window.__VIVARIUM_CHARACTER_PILOT__!;
    const expectations: readonly {
      readonly milestone: PilotMilestone;
      readonly primary: string;
      readonly secondary: string;
      readonly accessible: string;
      readonly expected: Partial<PilotFrame>;
    }[] = [
      {
        milestone: "front-idle",
        primary: "1 / 6 · Standing idle",
        secondary: "Facing forward",
        accessible: "Beat 1 of 6. Standing idle. Facing forward.",
        expected: { beat: "idle", phase: "idle-hold" },
      },
      {
        milestone: "east-mid-walk",
        primary: "2 / 6 · Walking right",
        secondary: "Facing right",
        accessible: "Beat 2 of 6. Walking right. Facing right.",
        expected: { beat: "walk", phase: "walk-route" },
      },
      {
        milestone: "reach-contact",
        primary: "4 / 6 · Giving resources",
        secondary: "Facing forward",
        accessible: "Beat 4 of 6. Giving resources. Facing forward.",
        expected: {
          beat: "reach",
          phase: "reach-action",
          lastMarker: "hand-contact",
        },
      },
      {
        milestone: "prone",
        primary: "6 / 6 · Injured - lying prone",
        secondary: "Facing forward",
        accessible: "Beat 6 of 6. Injured - lying prone. Facing forward.",
        expected: {
          beat: "prone",
          phase: "prone-hold",
          lastMarker: "fall-contact",
        },
      },
    ];

    for (const {
      milestone,
      primary,
      secondary,
      accessible,
      expected,
    } of expectations) {
      const drawCount = canvas.operations.filter(({ kind }) => kind === "drawImage").length;
      const operationCount = canvas.operations.length;
      await seek(bridge, milestone);
      expect(bridge.snapshot()).toMatchObject(expected);
      expect(container.querySelector(".character-pilot__beat")?.textContent)
        .toBe(primary);
      expect(canvas.operations.filter(({ kind }) => kind === "drawImage").length)
        .toBeGreaterThan(drawCount);
      expectPlaquePaint(
        canvas.operations.slice(operationCount),
        primary,
        secondary,
      );
      expect(container.querySelector("[role='status']")?.textContent)
        .toBe(accessible);
      expect(driver.pendingCount).toBe(0);
      expect(button(container, "Play").disabled).toBe(false);
    }
    expect(container.querySelectorAll("[aria-live='polite']")).toHaveLength(1);
  });

  it("explicitly restarts ownership in order and preserves a paused choice", async () => {
    const second = deferred<CharacterPilotBundle>();
    const firstBundle = createBundle("first");
    const secondBundle = createBundle("second");
    pilotHarness.acquire
      .mockResolvedValueOnce(firstBundle)
      .mockReturnValueOnce(second.promise);
    await act(async () => root?.render(<CharacterPilotStage frameDriver={driver} />));
    await settle();
    const firstBridge = window.__VIVARIUM_CHARACTER_PILOT__!;
    const firstTimeline = pilotHarness.timelines[0]!;
    await click(button(container, "Pause"));

    let restartPromise!: Promise<void>;
    await act(async () => {
      restartPromise = firstBridge.restart();
      await Promise.resolve();
    });
    expect(window.__VIVARIUM_CHARACTER_PILOT__).toBeUndefined();
    expect(vi.mocked(firstTimeline.dispose)).toHaveBeenCalledOnce();
    expect(firstBundle.release).toHaveBeenCalledOnce();
    expect(vi.mocked(firstTimeline.dispose).mock.invocationCallOrder[0])
      .toBeLessThan(firstBundle.release.mock.invocationCallOrder[0]!);
    expect(pilotHarness.acquire).toHaveBeenCalledTimes(2);
    expect(button(container, "Restart").disabled).toBe(true);
    expect(driver.pendingCount).toBe(0);

    second.resolve(secondBundle);
    await act(async () => {
      await restartPromise;
    });
    const secondBridge = window.__VIVARIUM_CHARACTER_PILOT__!;
    expect(secondBridge).not.toBe(firstBridge);
    expect(secondBridge.snapshot()).toMatchObject({
      beat: "idle",
      elapsedMs: 0,
      actor: { facing: "south" },
    });
    expect(button(container, "Play").disabled).toBe(false);
    expect(driver.pendingCount).toBe(0);
    await expect(firstBridge.seek("front-idle")).rejects.toThrow(/stale/i);
    expect(() => firstBridge.snapshot()).toThrow(/stale/i);
    await expect(firstBridge.restart()).rejects.toThrow(/stale/i);
  });

  it("aborts a pending acquisition and releases an abort-ignoring late bundle", async () => {
    const pending = deferred<CharacterPilotBundle>();
    const lateBundle = createBundle("late");
    pilotHarness.acquire.mockReturnValue(pending.promise);
    await act(async () => root?.render(<CharacterPilotStage frameDriver={driver} />));
    const signal = pilotHarness.acquire.mock.calls[0]?.[0] as AbortSignal;

    await act(async () => root?.unmount());
    root = null;
    expect(signal.aborted).toBe(true);
    pending.resolve(lateBundle);
    await settle();

    expect(lateBundle.release).toHaveBeenCalledOnce();
    expect(pilotHarness.timelines).toHaveLength(0);
    expect(driver.pendingCount).toBe(0);
    expect(window.__VIVARIUM_CHARACTER_PILOT__).toBeUndefined();
  });

  it("retires the StrictMode probe before one live acquisition starts at a microtask", async () => {
    const live = deferred<CharacterPilotBundle>();
    const liveBundle = createBundle("live");
    pilotHarness.acquire.mockReturnValue(live.promise);

    act(() => root?.render(
      <StrictMode>
        <CharacterPilotStage frameDriver={driver} />
      </StrictMode>,
    ));
    expect(pilotHarness.acquire).not.toHaveBeenCalled();

    await act(async () => {
      await Promise.resolve();
    });

    expect(pilotHarness.acquire).toHaveBeenCalledOnce();
    const liveSignal = pilotHarness.acquire.mock.calls[0]?.[0] as AbortSignal;
    expect(liveSignal.aborted).toBe(false);

    live.resolve(liveBundle);
    await settle();
    const liveBridge = window.__VIVARIUM_CHARACTER_PILOT__;
    expect(liveBridge).toBeDefined();
    expect(liveBundle.release).not.toHaveBeenCalled();
    expect(window.__VIVARIUM_CHARACTER_PILOT__).toBe(liveBridge);

    await act(async () => root?.unmount());
    root = null;
    expect(liveBundle.release).toHaveBeenCalledOnce();
    expect(vi.mocked(pilotHarness.timelines[0]!.dispose)).toHaveBeenCalledOnce();
    expect(window.__VIVARIUM_CHARACTER_PILOT__).toBeUndefined();
  });

  it("fails closed and focuses one fixed alert when no 2D context exists", async () => {
    const bundle = createBundle();
    contextSpy.mockReturnValue(null);
    pilotHarness.acquire.mockResolvedValue(bundle);
    await act(async () => root?.render(<CharacterPilotStage frameDriver={driver} />));
    await settle();

    expectFocusedFailure(container, "context");
    expect(bundle.release).toHaveBeenCalledOnce();
    expect(pilotHarness.timelines).toHaveLength(0);
    expect(driver.pendingCount).toBe(0);
    expect([...container.querySelectorAll("button")].every(({ disabled }) => disabled))
      .toBe(true);
  });

  it("fails closed without exposing acquisition details", async () => {
    pilotHarness.acquire.mockRejectedValue(
      new Error("private /tmp/provider-token acquisition"),
    );
    await act(async () => root?.render(<CharacterPilotStage frameDriver={driver} />));
    await settle();

    expectFocusedFailure(container, "provider-token");
    expect(pilotHarness.timelines).toHaveLength(0);
    expect(driver.pendingCount).toBe(0);
  });

  it("disposes the orphan actor when timeline construction fails", async () => {
    const bundle = createBundle();
    pilotHarness.acquire.mockResolvedValue(bundle);
    pilotHarness.failTimelineConstruction = new Error("private timeline construction");
    const dispose = vi.spyOn(ProductionLayeredHumanActor.prototype, "dispose");
    await act(async () => root?.render(<CharacterPilotStage frameDriver={driver} />));
    await settle();

    expectFocusedFailure(container, "timeline construction");
    expect(dispose).toHaveBeenCalledOnce();
    expect(bundle.release).toHaveBeenCalledOnce();
    expect(driver.pendingCount).toBe(0);
  });

  it("disposes timeline then bundle when first paint fails", async () => {
    const bundle = createBundle();
    canvas = recordedCanvas(new Error("private drawImage path"));
    contextSpy.mockReturnValue(canvas.context);
    pilotHarness.acquire.mockResolvedValue(bundle);
    await act(async () => root?.render(<CharacterPilotStage frameDriver={driver} />));
    await settle();

    expectFocusedFailure(container, "drawImage path");
    const timeline = pilotHarness.timelines[0]!;
    expect(vi.mocked(timeline.dispose)).toHaveBeenCalledOnce();
    expect(bundle.release).toHaveBeenCalledOnce();
    expect(vi.mocked(timeline.dispose).mock.invocationCallOrder[0])
      .toBeLessThan(bundle.release.mock.invocationCallOrder[0]!);
    expect(driver.pendingCount).toBe(0);
  });

  it("rejects art fallback without drawing a substitute person", async () => {
    const source = createBundle();
    const leases = new Map(source.leases);
    leases.delete("core-human-body-rigs");
    const bundle: RuntimeCharacterPilotBundle & { readonly release: Mock<() => void> } = {
      manifest: source.manifest,
      leases,
      release: vi.fn<() => void>(),
    };
    pilotHarness.acquire.mockResolvedValue(bundle);
    await act(async () => root?.render(<CharacterPilotStage frameDriver={driver} />));
    await settle();

    expectFocusedFailure(container, "fallback");
    expect(canvas.operations.filter(({ kind }) => kind === "drawImage")).toHaveLength(0);
    expect(bundle.release).toHaveBeenCalledOnce();
    expect(driver.pendingCount).toBe(0);
  });

  it("fails closed and cleans exactly once after a later runtime error", async () => {
    const bundle = createBundle();
    pilotHarness.acquire.mockResolvedValue(bundle);
    await act(async () => root?.render(<CharacterPilotStage frameDriver={driver} />));
    await settle();
    const timeline = pilotHarness.timelines[0]!;
    vi.mocked(timeline.advance).mockImplementationOnce(() => {
      throw new Error("private runtime frame");
    });

    await act(async () => driver.fire(100));
    expectFocusedFailure(container, "runtime frame");
    expect(vi.mocked(timeline.dispose)).toHaveBeenCalledOnce();
    expect(bundle.release).toHaveBeenCalledOnce();
    expect(driver.pendingCount).toBe(0);

    await act(async () => root?.unmount());
    root = null;
    expect(vi.mocked(timeline.dispose)).toHaveBeenCalledOnce();
    expect(bundle.release).toHaveBeenCalledOnce();
  });

  it("owns context loss while paused and rejects a seek interrupted during paint", async () => {
    const bundle = createBundle();
    pilotHarness.acquire.mockResolvedValue(bundle);
    await act(async () => root?.render(<CharacterPilotStage frameDriver={driver} />));
    await settle();
    const bridge = window.__VIVARIUM_CHARACTER_PILOT__!;
    const timeline = pilotHarness.timelines[0]!;
    const canvasElement = container.querySelector("canvas")!;
    await click(button(container, "Pause"));
    expect(driver.pendingCount).toBe(0);

    const contextLost = new Event("contextlost", { cancelable: true });
    vi.spyOn(canvas.context, "drawImage").mockImplementationOnce(() => {
      canvasElement.dispatchEvent(contextLost);
    });
    await act(async () => {
      await expect(bridge.seek("reach-contact")).rejects.toThrow(/stale/i);
    });

    expect(contextLost.defaultPrevented).toBe(true);
    expectFocusedFailure(container, "context");
    expect(driver.pendingCount).toBe(0);
    expect(vi.mocked(timeline.dispose)).toHaveBeenCalledOnce();
    expect(bundle.release).toHaveBeenCalledOnce();

    const afterCleanup = new Event("contextlost", { cancelable: true });
    canvasElement.dispatchEvent(afterCleanup);
    expect(afterCleanup.defaultPrevented).toBe(false);
    expect(vi.mocked(timeline.dispose)).toHaveBeenCalledOnce();
    expect(bundle.release).toHaveBeenCalledOnce();
  });

  it("keeps the dev entry isolated from production Rollup inputs and preserves pixel CSS", () => {
    const html = readFileSync(resolve(process.cwd(), "character-pilot.html"), "utf8");
    const entry = readFileSync(
      resolve(process.cwd(), "src/qa/characterPilot/entry.tsx"),
      "utf8",
    );
    const css = readFileSync(
      resolve(process.cwd(), "src/qa/characterPilot/CharacterPilotStage.css"),
      "utf8",
    );
    const vite = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");

    expect(html).toContain("<main id=\"root\"></main>");
    expect(html).toContain("/src/qa/characterPilot/entry.tsx");
    expect(html).toContain("<title>Vivarium character motion pilot</title>");
    expect(entry).toMatch(/<StrictMode>[\s\S]*<CharacterPilotStage \/>/);
    expect(entry).not.toMatch(/Vivarium2DApp|NirvanaProductionStage|Chronicle|\/api/);
    expect(css).toMatch(/image-rendering:\s*pixelated/);
    expect(css).toMatch(/aspect-ratio:\s*16\s*\/\s*9/);
    expect(css).toMatch(
      /\.character-pilot__frame\s*\{[^}]*box-sizing:\s*content-box;[^}]*width:\s*1024px;[^}]*max-width:\s*calc\(100%\s*-\s*8px\);[^}]*border:\s*4px/s,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*1087px\)\s*\{[\s\S]*?\.character-pilot__frame\s*\{[^}]*width:\s*512px;/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*535px\)\s*\{[\s\S]*?\.character-pilot__frame\s*\{[^}]*width:\s*calc\(100%\s*-\s*8px\);/,
    );
    expect(vite).not.toMatch(/character-pilot|characterPilot/);
  });
});
