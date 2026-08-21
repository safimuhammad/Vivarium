import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SharedAtlasPool } from "../assets/SharedAtlasPool";
import type { ProductionAssetLease } from "../assets/productionManifest";

const mocks = vi.hoisted(() => ({
  createSharedAtlasPool: vi.fn(),
  createNirvanaProductionManifest: vi.fn(),
  createNirvanaPaintPlan: vi.fn(),
  renderNirvanaPaintPlan: vi.fn(),
  renderNirvanaRegion: vi.fn(),
}));

vi.mock("../assets/SharedAtlasPool", () => ({
  createSharedAtlasPool: mocks.createSharedAtlasPool,
}));

vi.mock("./NirvanaAssetProfile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./NirvanaAssetProfile")>()),
  createNirvanaProductionManifest: mocks.createNirvanaProductionManifest,
}));

vi.mock("./NirvanaPainter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./NirvanaPainter")>()),
  createNirvanaPaintPlan: mocks.createNirvanaPaintPlan,
  renderNirvanaPaintPlan: mocks.renderNirvanaPaintPlan,
  renderNirvanaRegion: mocks.renderNirvanaRegion,
}));

import { NirvanaProductionStage } from "./NirvanaProductionStage";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root | null;
let getContext: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.createSharedAtlasPool.mockReset();
  mocks.createNirvanaProductionManifest.mockReset();
  mocks.createNirvanaProductionManifest.mockImplementation((base) => base);
  mocks.createNirvanaPaintPlan.mockReset();
  mocks.createNirvanaPaintPlan.mockReturnValue(Object.freeze({
    cacheIdentity: "nirvana-v2:test-stage",
    operations: Object.freeze([]),
  }));
  mocks.renderNirvanaPaintPlan.mockReset();
  mocks.renderNirvanaRegion.mockReset();
  getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(recordedContext() as unknown as CanvasRenderingContext2D);
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  getContext.mockRestore();
  container.remove();
  vi.restoreAllMocks();
});

describe("NirvanaProductionStage", () => {
  it("renders only the production Nirvana scenery identity and camera instructions", () => {
    const markup = renderToStaticMarkup(<NirvanaProductionStage />);

    expect(markup).toMatch(/aria-label="Nirvana production scenery"/);
    expect(markup).toMatch(/<h1[^>]*>Nirvana<\/h1>/);
    expect(markup).toMatch(/Drag[^<]*(?:WASD|arrow keys)/i);
    expect(markup).toMatch(/<canvas[^>]+tabindex="0"[^>]+aria-describedby=/i);
    expect(markup).not.toMatch(/pilot|Chronicle|actor|character|home|shelter|event|backend/i);
  });

  it("acquires exactly two production atlases, paints after both resolve, and releases ownership", async () => {
    const terrainRelease = vi.fn();
    const landmarkRelease = vi.fn();
    const pool = fakePool((id) => Promise.resolve(
      lease(id.includes("terrain") ? terrainRelease : landmarkRelease, id),
    ));
    mocks.createSharedAtlasPool.mockReturnValue(pool);

    await act(async () => root?.render(<NirvanaProductionStage />));
    await settle();

    expect(pool.acquire).toHaveBeenCalledTimes(2);
    expect(vi.mocked(pool.acquire).mock.calls.map(([id]) => id).sort()).toEqual([
      "nirvana-v3-scenery",
      "nirvana-v3-terrain",
    ]);
    expect(mocks.renderNirvanaPaintPlan).toHaveBeenCalled();

    await act(async () => root?.unmount());
    root = null;
    expect(terrainRelease).toHaveBeenCalledOnce();
    expect(landmarkRelease).toHaveBeenCalledOnce();
    expect(pool.dispose).toHaveBeenCalledOnce();
  });

  it("shows a safe failure when the Nirvana manifest overlay cannot be constructed", async () => {
    mocks.createNirvanaProductionManifest.mockImplementationOnce(() => {
      throw new Error("private manifest internals");
    });

    await act(async () => root?.render(<NirvanaProductionStage />));
    await settle();

    const alert = container.querySelector<HTMLElement>("[role='alert']");
    expect(alert?.textContent).toMatch(/unable|atlas|scenery/i);
    expect(alert?.textContent).not.toMatch(/private|manifest internals/i);
    expect(mocks.createSharedAtlasPool).not.toHaveBeenCalled();
    expect(mocks.renderNirvanaPaintPlan).not.toHaveBeenCalled();
  });

  it("does not paint until both atlas leases have resolved", async () => {
    const terrain = deferred<ProductionAssetLease<ImageBitmap>>();
    const landmarks = deferred<ProductionAssetLease<ImageBitmap>>();
    const terrainRelease = vi.fn();
    const landmarkRelease = vi.fn();
    const pool = fakePool((id) => (
      id === "nirvana-v3-terrain" ? terrain.promise : landmarks.promise
    ));
    mocks.createSharedAtlasPool.mockReturnValue(pool);

    await act(async () => root?.render(<NirvanaProductionStage />));
    expect(mocks.renderNirvanaPaintPlan).not.toHaveBeenCalled();

    terrain.resolve(lease(terrainRelease, "nirvana-v3-terrain"));
    await settle();
    expect(mocks.renderNirvanaPaintPlan).not.toHaveBeenCalled();

    landmarks.resolve(lease(landmarkRelease, "nirvana-v3-scenery"));
    await settle();
    expect(mocks.renderNirvanaPaintPlan).toHaveBeenCalledOnce();

    await act(async () => root?.unmount());
    root = null;
    expect(terrainRelease).toHaveBeenCalledOnce();
    expect(landmarkRelease).toHaveBeenCalledOnce();
  });

  it("aborts and disposes pending acquisitions, then releases each late lease once", async () => {
    const terrain = deferred<ProductionAssetLease<ImageBitmap>>();
    const landmarks = deferred<ProductionAssetLease<ImageBitmap>>();
    const terrainRelease = vi.fn();
    const landmarkRelease = vi.fn();
    const pool = fakePool((id) => (
      id === "nirvana-v3-terrain" ? terrain.promise : landmarks.promise
    ));
    mocks.createSharedAtlasPool.mockReturnValue(pool);

    await act(async () => root?.render(<NirvanaProductionStage />));
    const signals = vi.mocked(pool.acquire).mock.calls.map(([, signal]) => signal);

    await act(async () => root?.unmount());
    root = null;
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal?.aborted === true)).toBe(true);
    expect(pool.dispose).toHaveBeenCalledOnce();

    terrain.resolve(lease(terrainRelease, "nirvana-v3-terrain"));
    landmarks.resolve(lease(landmarkRelease, "nirvana-v3-scenery"));
    await settle();

    expect(terrainRelease).toHaveBeenCalledOnce();
    expect(landmarkRelease).toHaveBeenCalledOnce();
    expect(mocks.renderNirvanaPaintPlan).not.toHaveBeenCalled();
  });

  it("releases a lease delivered after its sibling acquisition fails", async () => {
    const terrain = deferred<ProductionAssetLease<ImageBitmap>>();
    const terrainRelease = vi.fn();
    const pool = fakePool((id) => (
      id === "nirvana-v3-terrain"
        ? terrain.promise
        : Promise.reject(new Error("private late-failure detail"))
    ));
    mocks.createSharedAtlasPool.mockReturnValue(pool);

    await act(async () => root?.render(<NirvanaProductionStage />));
    await settle();
    expect(pool.dispose).toHaveBeenCalledOnce();
    expect(container.querySelector("[role='alert']")?.textContent).not.toMatch(/private/i);

    terrain.resolve(lease(terrainRelease, "nirvana-v3-terrain"));
    await settle();

    expect(terrainRelease).toHaveBeenCalledOnce();
    expect(mocks.renderNirvanaPaintPlan).not.toHaveBeenCalled();
  });

  it("isolates StrictMode atlas ownership by effect generation", async () => {
    const firstTerrain = deferred<ProductionAssetLease<ImageBitmap>>();
    const firstLandmarks = deferred<ProductionAssetLease<ImageBitmap>>();
    const secondTerrain = deferred<ProductionAssetLease<ImageBitmap>>();
    const secondLandmarks = deferred<ProductionAssetLease<ImageBitmap>>();
    const firstTerrainRelease = vi.fn();
    const firstLandmarkRelease = vi.fn();
    const secondTerrainRelease = vi.fn();
    const secondLandmarkRelease = vi.fn();
    const firstPool = fakePool((id) => (
      id === "nirvana-v3-terrain" ? firstTerrain.promise : firstLandmarks.promise
    ));
    const secondPool = fakePool((id) => (
      id === "nirvana-v3-terrain" ? secondTerrain.promise : secondLandmarks.promise
    ));
    mocks.createSharedAtlasPool
      .mockReturnValueOnce(firstPool)
      .mockReturnValueOnce(secondPool);

    await act(async () => root?.render(
      <StrictMode>
        <NirvanaProductionStage />
      </StrictMode>,
    ));

    expect(mocks.createSharedAtlasPool).toHaveBeenCalledTimes(2);
    expect(firstPool.dispose).toHaveBeenCalledOnce();
    expect(
      vi.mocked(firstPool.acquire).mock.calls.every(([, signal]) => signal?.aborted === true),
    ).toBe(true);

    firstTerrain.resolve(lease(firstTerrainRelease, "nirvana-v3-terrain"));
    firstLandmarks.resolve(lease(firstLandmarkRelease, "nirvana-v3-scenery"));
    secondTerrain.resolve(lease(secondTerrainRelease, "nirvana-v3-terrain"));
    secondLandmarks.resolve(lease(secondLandmarkRelease, "nirvana-v3-scenery"));
    await settle();

    expect(firstTerrainRelease).toHaveBeenCalledOnce();
    expect(firstLandmarkRelease).toHaveBeenCalledOnce();
    expect(mocks.renderNirvanaPaintPlan).toHaveBeenCalledOnce();

    await act(async () => root?.unmount());
    root = null;
    expect(secondTerrainRelease).toHaveBeenCalledOnce();
    expect(secondLandmarkRelease).toHaveBeenCalledOnce();
    expect(secondPool.dispose).toHaveBeenCalledOnce();
  });

  it("releases a partial atlas bundle and exposes only a safe public failure", async () => {
    const terrainRelease = vi.fn();
    const pool = fakePool((id) => (
      id === "nirvana-v3-terrain"
        ? Promise.resolve(lease(terrainRelease, id))
        : Promise.reject(new Error("private /tmp/provider token"))
    ));
    mocks.createSharedAtlasPool.mockReturnValue(pool);

    await act(async () => root?.render(<NirvanaProductionStage />));
    await settle();

    const alert = container.querySelector<HTMLElement>("[role='alert']");
    expect(alert?.textContent).toMatch(/unable|atlas|scenery/i);
    expect(alert?.textContent).not.toMatch(/private|tmp|provider|token/i);
    expect(terrainRelease).toHaveBeenCalledOnce();
    expect(pool.dispose).toHaveBeenCalledOnce();
    expect(mocks.renderNirvanaPaintPlan).not.toHaveBeenCalled();
  });

  it("builds one immutable paint plan and reuses it across camera paints", async () => {
    const pool = fakePool((id) => Promise.resolve(lease(vi.fn(), id)));
    mocks.createSharedAtlasPool.mockReturnValue(pool);
    await act(async () => root?.render(<NirvanaProductionStage />));
    await settle();

    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    const plan = mocks.createNirvanaPaintPlan.mock.results[0]?.value;
    expect(mocks.createNirvanaPaintPlan).toHaveBeenCalledOnce();
    expect(mocks.renderNirvanaPaintPlan).toHaveBeenCalledOnce();
    expect(mocks.renderNirvanaPaintPlan.mock.calls[0]?.[4]).toBe(plan);

    await act(async () => canvas!.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    })));

    expect(mocks.createNirvanaPaintPlan).toHaveBeenCalledOnce();
    expect(mocks.renderNirvanaPaintPlan).toHaveBeenCalledTimes(2);
    expect(mocks.renderNirvanaPaintPlan.mock.calls[1]?.[4]).toBe(plan);
    expect(mocks.renderNirvanaRegion).not.toHaveBeenCalled();
  });

  it("sends integer clamped camera changes to the painter for keys and pointer drags", async () => {
    const pool = fakePool((id) => Promise.resolve(lease(vi.fn(), id)));
    mocks.createSharedAtlasPool.mockReturnValue(pool);
    await act(async () => root?.render(<NirvanaProductionStage />));
    await settle();

    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    vi.spyOn(canvas!, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 960,
      bottom: 540,
      width: 960,
      height: 540,
      toJSON: () => ({}),
    });
    Object.defineProperty(canvas, "setPointerCapture", { value: vi.fn() });
    Object.defineProperty(canvas, "releasePointerCapture", { value: vi.fn() });

    const beforeKey = lastCamera();
    await act(async () => canvas!.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    })));
    const afterKey = lastCamera();
    expect(afterKey.x).toBeGreaterThan(beforeKey.x);

    await act(async () => {
      canvas!.dispatchEvent(pointerEvent("pointerdown", 1, 500, 300));
      canvas!.dispatchEvent(pointerEvent("pointermove", 1, 452, 252));
      canvas!.dispatchEvent(pointerEvent("pointerup", 1, 452, 252));
    });
    const afterDrag = lastCamera();
    expect(afterDrag.x).toBeGreaterThan(afterKey.x);
    expect(afterDrag.y).toBeGreaterThan(afterKey.y);
    expect(Number.isInteger(afterDrag.x)).toBe(true);
    expect(Number.isInteger(afterDrag.y)).toBe(true);
  });

  it("clears drag ownership when pointer capture has already been lost", async () => {
    const pool = fakePool((id) => Promise.resolve(lease(vi.fn(), id)));
    mocks.createSharedAtlasPool.mockReturnValue(pool);
    await act(async () => root?.render(<NirvanaProductionStage />));
    await settle();

    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    vi.spyOn(canvas!, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 960,
      bottom: 540,
      width: 960,
      height: 540,
      toJSON: () => ({}),
    });
    Object.defineProperty(canvas, "setPointerCapture", { value: vi.fn() });
    Object.defineProperty(canvas, "releasePointerCapture", {
      value: vi.fn(() => {
        throw new DOMException("Capture already gone", "NotFoundError");
      }),
    });

    await act(async () => {
      canvas!.dispatchEvent(pointerEvent("pointerdown", 7, 500, 300));
      canvas!.dispatchEvent(pointerEvent("pointermove", 7, 452, 252));
      canvas!.dispatchEvent(pointerEvent("pointercancel", 7, 452, 252));
    });
    const afterCancel = lastCamera();
    const paintCount = mocks.renderNirvanaPaintPlan.mock.calls.length;

    await act(async () => {
      canvas!.dispatchEvent(pointerEvent("pointermove", 7, 300, 100));
    });

    expect(mocks.renderNirvanaPaintPlan).toHaveBeenCalledTimes(paintCount);
    expect(lastCamera()).toEqual(afterCancel);
  });
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function lease(
  release: () => void,
  id = "bitmap",
): ProductionAssetLease<ImageBitmap> {
  // owner-authorised Option A re-baseline, plan §P3: `createNirvanaAtlasAssets` is not
  // mocked here, so these fake bitmaps must match the real nirvana-v3 atlas geometry
  // (512x800 terrain, 672x1010 scenery) or its canvas-source validation throws.
  return Object.freeze({
    value: { width: id.includes("terrain") ? 512 : 672, height: id.includes("terrain") ? 800 : 1010 } as ImageBitmap,
    release,
  });
}

function fakePool(
  acquire: (id: string, signal?: AbortSignal) => Promise<ProductionAssetLease<ImageBitmap>>,
): SharedAtlasPool {
  return {
    acquire: vi.fn(acquire),
    retain: vi.fn(),
    diagnostics: vi.fn(),
    dispose: vi.fn(),
  } as unknown as SharedAtlasPool;
}

function recordedContext(): Partial<CanvasRenderingContext2D> {
  return {
    imageSmoothingEnabled: true,
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  };
}

function lastCamera(): Readonly<{ x: number; y: number }> {
  const call = mocks.renderNirvanaPaintPlan.mock.calls.at(-1);
  if (call === undefined) throw new Error("Painter has not received a camera");
  return call[3] as Readonly<{ x: number; y: number }>;
}

function pointerEvent(
  type: string,
  pointerId: number,
  clientX: number,
  clientY: number,
): Event {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}
