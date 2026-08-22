import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ObserverRendererPort } from "../../presentation/rendererPort";
import type {
  CameraMode,
  ObserverSelection,
  PresentedObserverFrame,
  SafeFrameInsets,
} from "../../presentation/contracts";
import { createRendererSemanticSnapshot } from "./semantics";
import { createRegionMapIdentity } from "./maps/RegionMapIdentity";
import { createRegionMapRecipe } from "./maps/RegionMapRecipe";
import type { PlacementLedger } from "./placement/PlacementLedger";
import type { SharedAtlasPool } from "./assets/SharedAtlasPool";
import type { AtlasCommitScheduler } from "./AtlasCommitScheduler";
import {
  createProductionCanvasSceneRenderer,
  type ProductionCanvasSceneRendererOptions,
} from "./ProductionCanvasSceneFactory";
import {
  PresentationWorldStage,
  type PresentationFrameSource,
} from "./PresentationWorldStage";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("./ProductionCanvasSceneFactory", () => ({
  createProductionCanvasSceneRenderer: vi.fn(),
}));

const createRenderer = vi.mocked(createProductionCanvasSceneRenderer);
const placement = {} as PlacementLedger;
const regionValue = {
  name: "worn",
  description: "a once-heavenly landscape, now thinning and picked-over",
  connections: [],
  energy_rate: 0.2,
  materials_rate: 0.2,
  current_energy: 50,
  current_materials: 40,
  max_energy: 100,
  max_materials: 100,
};
const recipes = new Map([
  ["worn", createRegionMapRecipe(createRegionMapIdentity(71, regionValue, [regionValue]))],
]);

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  ResizeObserverFake.instances = [];
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverFake,
  });
  createRenderer.mockReset();
  createRenderer.mockResolvedValue(makeRenderer());
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  container.remove();
  vi.restoreAllMocks();
});

describe("PresentationWorldStage", () => {
  it("keeps heavy renderer and scene factories behind one dynamic production boundary", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/renderer2d/production/PresentationWorldStage.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/from ["']\.\/CanvasPresentationRenderer["']/);
    expect(source).not.toMatch(/from ["']\.\/(?:actors\/LayeredHumanActor|homes\/HomeActor|environment\/EnvironmentSystem)["']/);
    expect(source).not.toMatch(/from ["']\.\/assets\/productionManifest["']/);
    expect(source).toMatch(/import\(["']\.\/ProductionCanvasSceneFactory["']\)/);
  });

  it("renders one canvas and binds the exact placement, recipes, and renderer lifecycle options", async () => {
    const source = makeSource(frame(1));
    const frameAcceptance = { markAccepted: vi.fn() };
    const onSceneSignals = vi.fn();
    await act(async () => root?.render(stage(source, { frameAcceptance, onSceneSignals })));
    await settle();

    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(createRenderer).toHaveBeenCalledOnce();
    const options = createRenderer.mock.calls[0]![0];
    expect(options).toMatchObject({
      canvas: container.querySelector("canvas"),
      placement,
      recipes,
      frameAcceptance: { markAccepted: expect.any(Function) },
      onSceneSignals,
    });
    expect(options.frameAcceptance).not.toBe(frameAcceptance);
    expect(options.atlasPool).toBeUndefined();
    expect(options.atlasCommitScheduler).toBeUndefined();
    expect(frameAcceptance.markAccepted).toHaveBeenCalledWith(source.getSnapshot());
  });

  it("forwards an optional shared atlas pool without changing omitted ownership", async () => {
    const pool = {} as SharedAtlasPool;
    const source = makeSource(frame(1));
    await act(async () => root?.render(stage(source, { atlasPool: pool })));
    await settle();

    expect(createRenderer).toHaveBeenCalledOnce();
    expect(createRenderer.mock.calls[0]![0].atlasPool).toBe(pool);
  });

  it("forwards the exact optional atlas commit scheduler through the lazy factory boundary", async () => {
    const atlasCommitScheduler = {
      schedule: vi.fn(() => 1),
      cancel: vi.fn(),
    } satisfies AtlasCommitScheduler;
    const source = makeSource(frame(1));
    await act(async () => root?.render(stage(source, { atlasCommitScheduler })));
    await settle();

    expect(createRenderer).toHaveBeenCalledOnce();
    expect(createRenderer.mock.calls[0]![0].atlasCommitScheduler).toBe(atlasCommitScheduler);
  });

  it("subscribes after install, presents the current/latest frame, and swaps injected sources without recreating", async () => {
    const renderer = makeRenderer();
    createRenderer.mockResolvedValue(renderer);
    const first = makeSource(frame(1));
    const second = makeSource(frame(8, "archive:run-one"));
    await mount(first);

    expect(first.subscribe).toHaveBeenCalledOnce();
    expect(renderer.updatePresentation).toHaveBeenLastCalledWith(first.getSnapshot());
    first.publish(frame(2));
    first.publish(frame(3));
    await act(async () => undefined);
    expect(renderer.updatePresentation).toHaveBeenLastCalledWith(first.getSnapshot());

    await act(async () => root?.render(stage(second)));
    expect(first.unsubscribe).toHaveBeenCalledOnce();
    expect(second.subscribe).toHaveBeenCalledOnce();
    expect(renderer.updatePresentation).toHaveBeenLastCalledWith(second.getSnapshot());
    first.publish(frame(4));
    expect(renderer.updatePresentation).not.toHaveBeenLastCalledWith(first.getSnapshot());
    expect(createRenderer).toHaveBeenCalledOnce();
  });

  it("forwards positive resizes and recreates exactly once for reactive reduced motion", async () => {
    const renderer = makeRenderer();
    const replacement = makeRenderer();
    createRenderer.mockResolvedValueOnce(renderer).mockResolvedValueOnce(replacement);
    const source = makeSource(frame(1));
    const firstInsets: SafeFrameInsets = { top: 12, right: 8, bottom: 48, left: 8 };
    await act(async () => root?.render(stage(source, { safeFrame: firstInsets, reducedMotion: true })));
    await settle();

    ResizeObserverFake.instances[0]!.emit(390.8, 844.2);
    ResizeObserverFake.instances[0]!.emit(0, 844);
    ResizeObserverFake.instances[0]!.emit(Number.NaN, 844);
    expect(renderer.resize).toHaveBeenCalledTimes(1);
    expect(renderer.resize).toHaveBeenCalledWith(390.8, 844.2);
    expect(renderer.setSafeFrame).toHaveBeenLastCalledWith(firstInsets);
    expect(createRenderer.mock.calls[0]![0].reducedMotion).toBe(true);

    const nextInsets: SafeFrameInsets = { top: 20, right: 10, bottom: 60, left: 10 };
    await act(async () => root?.render(stage(source, { safeFrame: nextInsets, reducedMotion: false })));
    await settle();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(replacement.setSafeFrame).toHaveBeenLastCalledWith(nextInsets);
    expect(replacement.updatePresentation).toHaveBeenCalledWith(source.getSnapshot());
    expect(createRenderer).toHaveBeenCalledTimes(2);
    expect(createRenderer.mock.calls[1]![0].reducedMotion).toBe(false);
  });

  it("restores Canvas focus across a reduced-motion renderer replacement", async () => {
    createRenderer.mockResolvedValueOnce(makeRenderer()).mockResolvedValueOnce(makeRenderer());
    const source = makeSource(frame(1));
    await act(async () => root?.render(stage(source, { reducedMotion: false })));
    await settle();
    const first = container.querySelector("canvas")!;
    first.focus();
    expect(document.activeElement).toBe(first);

    await act(async () => root?.render(stage(source, { reducedMotion: true })));
    await settle();
    const second = container.querySelector("canvas")!;
    expect(second).not.toBe(first);
    expect(document.activeElement).toBe(second);
  });

  it("surfaces a concise retryable initialization failure and retries with a clean generation", async () => {
    const second = makeRenderer();
    createRenderer
      .mockRejectedValueOnce(new Error("private /tmp/secret atlas path"))
      .mockResolvedValueOnce(second);
    await mount(makeSource(frame(1)));

    const alert = container.querySelector<HTMLElement>("[role='alert']");
    expect(alert?.textContent).toMatch(/world|canvas|render/i);
    expect(alert?.textContent).not.toMatch(/private|\/tmp|secret/i);
    const retry = [...container.querySelectorAll("button")].find((node) => /retry/i.test(node.textContent ?? ""));
    expect(retry).toBeDefined();
    await act(async () => retry!.click());
    await settle();
    expect(createRenderer).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  it("composes renderer failures with the caller callback without leaking private detail", async () => {
    const onFailure = vi.fn();
    await act(async () => root?.render(stage(makeSource(frame(1)), { callbacks: { onFailure } })));
    await settle();
    const callbacks = createRenderer.mock.calls[0]![0].callbacks;
    await act(async () => {
      callbacks.onFailure?.({
        kind: "asset",
        retryable: true,
        publicMessage: "The visible region could not be prepared.",
      });
    });
    expect(onFailure).toHaveBeenCalledOnce();
    expect(container.querySelector("[role='alert']")?.textContent).toContain("visible region");
  });

  it("reports a nonfatal marker without replacing or pausing the accepted world", async () => {
    const onFailure = vi.fn();
    await act(async () => root?.render(stage(makeSource(frame(1)), { callbacks: { onFailure } })));
    await settle();
    const world = container.querySelector<HTMLElement>(".presentation-world-stage")!;
    const canvas = container.querySelector<HTMLCanvasElement>("canvas")!;
    expect(world.getAttribute("data-ready")).toBe("true");

    const marker = {
      kind: "marker" as const,
      retryable: false,
      publicMessage: "A presentation marker was skipped.",
    };
    await act(async () => createRenderer.mock.calls[0]![0].callbacks.onFailure?.(marker));

    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith(marker);
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(container.textContent).not.toContain("Retry world");
    expect(world.getAttribute("data-ready")).toBe("true");
    expect(container.querySelector("canvas")).toBe(canvas);
  });

  it("cleans up source, observer, renderer, then aborts exactly once and ignores late observer work", async () => {
    const order: string[] = [];
    const source = makeSource(frame(1), order);
    const renderer = makeRenderer(order);
    createRenderer.mockImplementation(async (options: ProductionCanvasSceneRendererOptions) => {
      options.signal?.addEventListener("abort", () => order.push("abort"), { once: true });
      return renderer;
    });
    await mount(source);
    const observer = ResizeObserverFake.instances[0]!;
    observer.onDisconnect = () => order.push("resize");

    await act(async () => root?.unmount());
    root = null;
    observer.emit(500, 500);
    source.publish(frame(2));
    expect(order).toEqual(["unsubscribe", "resize", "dispose", "abort"]);
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(renderer.resize).not.toHaveBeenCalled();
  });

  it("keeps the newer StrictMode renderer when the aborted lazy factory resolves late", async () => {
    const first = deferred<ObserverRendererPort>();
    const second = deferred<ObserverRendererPort>();
    const oldRenderer = makeRenderer();
    const currentRenderer = makeRenderer();
    createRenderer
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    await act(async () => root?.render(<StrictMode>{stage(makeSource(frame(1)))}</StrictMode>));
    await settle();
    await settle();
    expect(createRenderer).toHaveBeenCalledTimes(2);
    expect(createRenderer.mock.calls[0]![0].signal?.aborted).toBe(true);
    expect(createRenderer.mock.calls[1]![0].signal?.aborted).toBe(false);
    second.resolve(currentRenderer);
    await settle();
    first.resolve(oldRenderer);
    await settle();
    expect(oldRenderer.dispose).toHaveBeenCalledOnce();
    expect(currentRenderer.dispose).not.toHaveBeenCalled();

    await act(async () => root?.unmount());
    root = null;
    expect(currentRenderer.dispose).toHaveBeenCalledOnce();
  });

  it("keeps the newer renderer when a superseded factory generation resolves late", async () => {
    const first = deferred<ObserverRendererPort>();
    const second = deferred<ObserverRendererPort>();
    const oldRenderer = makeRenderer();
    const currentRenderer = makeRenderer();
    createRenderer
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const source = makeSource(frame(1));
    await act(async () => root?.render(stage(source, { placement: {} as PlacementLedger })));
    await settle();
    await act(async () => root?.render(stage(source, { placement: {} as PlacementLedger })));
    await settle();
    expect(createRenderer).toHaveBeenCalledTimes(2);
    expect(createRenderer.mock.calls[0]![0].signal?.aborted).toBe(true);
    second.resolve(currentRenderer);
    await settle();
    first.resolve(oldRenderer);
    await settle();
    expect(oldRenderer.dispose).toHaveBeenCalledOnce();
    expect(currentRenderer.dispose).not.toHaveBeenCalled();

    await act(async () => root?.unmount());
    root = null;
    expect(currentRenderer.dispose).toHaveBeenCalledOnce();
  });

  it("does not double-dispose an already-disposed late renderer", async () => {
    const pending = deferred<ObserverRendererPort>();
    const late = makeRenderer();
    vi.mocked(late.diagnostics).mockReturnValue({ ...diagnostics, disposed: true });
    createRenderer.mockImplementation(() => pending.promise);
    await act(async () => root?.render(stage(makeSource(frame(1)))));
    await act(async () => root?.unmount());
    root = null;
    pending.resolve(late);
    await settle();
    expect(late.dispose).not.toHaveBeenCalled();
  });

  it("refuses an already-disposed renderer resolved into the active generation", async () => {
    const disposed = makeRenderer();
    vi.mocked(disposed.diagnostics).mockReturnValue({ ...diagnostics, disposed: true });
    createRenderer.mockResolvedValue(disposed);
    const source = makeSource(frame(1));

    await mount(source);

    expect(source.subscribe).not.toHaveBeenCalled();
    expect(disposed.updatePresentation).not.toHaveBeenCalled();
    expect(ResizeObserverFake.instances).toHaveLength(0);
    expect(container.querySelector(".presentation-world-stage")?.getAttribute("data-ready")).toBe("false");
    expect(container.querySelector("[role='alert']")?.textContent).toMatch(/world|render|start/i);
    expect(disposed.dispose).not.toHaveBeenCalled();
  });

  it("hands the camera back from a ZOOM, where no mode ever changed", async () => {
    // The defect the retired "Resume story framing" badge died of. A viewer zoom
    // takes framing authority WITHOUT changing the camera mode, so a shell that
    // mirrors the mode still reads `story` -- and every dedup on the way here
    // (the shell's, and this file's own `requestCameraMode`) swallowed the
    // `story` request. The renderer's `setCameraMode("story")` is the one entry
    // point that knows a same-mode request still releases, and the serial is
    // what reaches it. Without this the viewer is stranded with no way back.
    const renderer = makeRenderer();
    createRenderer.mockResolvedValue(renderer);
    const source = makeSource(frame(1));
    givenCanvasBounds();

    await act(async () => root?.render(stage(source, {
      cameraMode: "story",
      resumeStorySerial: 0,
    })));
    await settle();
    expect(renderer.setCameraMode).not.toHaveBeenCalled();

    // The zoom. No mode change follows it, exactly as in production.
    await act(async () => {
      const canvas = container.querySelector("canvas")!;
      canvas.dispatchEvent(new WheelEvent("wheel", {
        deltaY: -240, ctrlKey: true, bubbles: true, cancelable: true,
      }));
    });
    expect(renderer.zoomCamera).toHaveBeenCalled();
    expect(renderer.setCameraMode).not.toHaveBeenCalled();

    await act(async () => root?.render(stage(source, {
      cameraMode: "story",
      resumeStorySerial: 1,
    })));
    expect(renderer.setCameraMode).toHaveBeenCalledWith("story");
  });

  it("asks once per serial, and never for a serial it has already served", async () => {
    const renderer = makeRenderer();
    createRenderer.mockResolvedValue(renderer);
    const source = makeSource(frame(1));
    await act(async () => root?.render(stage(source, { resumeStorySerial: 3 })));
    await settle();
    // The serial a stage MOUNTS with is history, not a request.
    expect(renderer.setCameraMode).not.toHaveBeenCalled();

    await act(async () => root?.render(stage(source, { resumeStorySerial: 4 })));
    expect(renderer.setCameraMode).toHaveBeenCalledTimes(1);
    await act(async () => root?.render(stage(source, { resumeStorySerial: 4 })));
    expect(renderer.setCameraMode).toHaveBeenCalledTimes(1);
    await act(async () => root?.render(stage(source, { resumeStorySerial: 5 })));
    expect(renderer.setCameraMode).toHaveBeenCalledTimes(2);
    expect(vi.mocked(renderer.setCameraMode).mock.calls).toEqual([["story"], ["story"]]);
  });

  it("keeps the S key on the same release path, not on the deduplicating one", async () => {
    const renderer = makeRenderer();
    createRenderer.mockResolvedValue(renderer);
    await mount(makeSource(frame(1)));

    await act(async () => {
      container.querySelector("canvas")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true }),
      );
    });
    expect(renderer.setCameraMode).toHaveBeenCalledWith("story");
  });

  it("offers no camera badge of its own over the world", async () => {
    // Owner direction (Safi, asked twice, decided 2026-08-22): the cream
    // "You are steering the view." pill is gone from the art. The reading lives
    // in the persistent HUD instead, and the way back is proved above.
    const renderer = makeRenderer();
    createRenderer.mockResolvedValue(renderer);
    givenCanvasBounds();
    await mount(makeSource(frame(1)));
    await act(async () => {
      const canvas = container.querySelector("canvas")!;
      canvas.dispatchEvent(new WheelEvent("wheel", {
        deltaY: -240, ctrlKey: true, bubbles: true, cancelable: true,
      }));
    });
    expect(renderer.zoomCamera).toHaveBeenCalled();
    expect(container.textContent).not.toContain("You are steering the view.");
    expect(container.textContent).not.toContain("Resume story framing");
    expect(container.querySelector(".presentation-world-stage__camera-release")).toBeNull();
  });

  it("does not install a cast-only visibility listener; the concrete renderer remains its sole owner", async () => {
    const add = vi.spyOn(document, "addEventListener");
    await mount(makeSource(frame(1)));
    expect(add.mock.calls.filter(([type]) => type === "visibilitychange")).toHaveLength(0);
  });

  it("delivers controlled camera, focus serial, and observed region on install and only on accepted changes", async () => {
    const renderer = makeRenderer();
    vi.mocked(renderer.setCameraMode).mockImplementation((mode) => {
      createRenderer.mock.calls[0]![0].callbacks.onCameraModeChange?.(mode);
    });
    createRenderer.mockResolvedValue(renderer);
    const source = makeSource(frame(1));
    const focus = { serial: 7, selection: { kind: "region", id: "worn" } as const };
    await act(async () => root?.render(stage(source, {
      cameraMode: "free",
      focusRequest: focus,
      observedRegionId: "worn",
    })));
    await settle();

    expect(renderer.setCameraMode).toHaveBeenCalledOnce();
    expect(renderer.setCameraMode).toHaveBeenCalledWith("free");
    expect(renderer.focusSelection).toHaveBeenCalledOnce();
    expect(renderer.focusSelection).toHaveBeenCalledWith(focus.selection);
    expect(renderer.observeRegion).toHaveBeenCalledOnce();
    expect(renderer.observeRegion).toHaveBeenCalledWith("worn");
    expect(renderer.setSelection).not.toHaveBeenCalled();
    expect(renderer.updatePresentation).toHaveBeenCalledOnce();

    await act(async () => root?.render(stage(source, {
      cameraMode: "free",
      focusRequest: focus,
      observedRegionId: "worn",
    })));
    expect(renderer.setCameraMode).toHaveBeenCalledOnce();
    expect(renderer.focusSelection).toHaveBeenCalledOnce();
    expect(renderer.observeRegion).toHaveBeenCalledOnce();

    const nextFocus = { serial: 8, selection: { kind: "agent", id: "aster" } as const };
    await act(async () => root?.render(stage(source, {
      cameraMode: "story",
      focusRequest: nextFocus,
      observedRegionId: "spring",
    })));
    expect(renderer.setCameraMode).toHaveBeenLastCalledWith("story");
    expect(renderer.focusSelection).toHaveBeenLastCalledWith(nextFocus.selection);
    expect(renderer.observeRegion).toHaveBeenLastCalledWith("spring");
    expect(renderer.setSelection).not.toHaveBeenCalled();
    expect(renderer.updatePresentation).toHaveBeenCalledOnce();
  });

  it("does not cache a rejected Follow request and accepts the retry after Canvas confirms it", async () => {
    const onCameraModeChange = vi.fn();
    const onCameraModeRequestRejected = vi.fn();
    let canFollow = false;
    const renderer = makeRenderer();
    vi.mocked(renderer.setCameraMode).mockImplementation((mode) => {
      const callbacks = createRenderer.mock.calls[0]![0].callbacks;
      if (mode !== "follow" || canFollow) callbacks.onCameraModeChange?.(mode);
    });
    createRenderer.mockResolvedValue(renderer);
    const source = makeSource(frame(1));

    await act(async () => root?.render(stage(source, {
      cameraMode: "story",
      callbacks: { onCameraModeChange },
      onCameraModeRequestRejected,
    })));
    await settle();
    await act(async () => root?.render(stage(source, {
      cameraMode: "follow",
      callbacks: { onCameraModeChange },
      onCameraModeRequestRejected,
    })));
    expect(onCameraModeChange).not.toHaveBeenCalledWith("follow");
    expect(onCameraModeRequestRejected).toHaveBeenCalledWith("follow");

    await act(async () => root?.render(stage(source, {
      cameraMode: "story",
      callbacks: { onCameraModeChange },
      onCameraModeRequestRejected,
    })));
    canFollow = true;
    await act(async () => root?.render(stage(source, {
      cameraMode: "follow",
      callbacks: { onCameraModeChange },
      onCameraModeRequestRejected,
    })));
    expect(vi.mocked(renderer.setCameraMode).mock.calls
      .filter(([mode]) => mode === "follow")).toHaveLength(2);
    expect(onCameraModeChange).toHaveBeenLastCalledWith("follow");
  });

  it("reapplies durable observer state to a replacement generation without letting an older focus serial win", async () => {
    const first = makeRenderer();
    const second = makeRenderer();
    createRenderer.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const source = makeSource(frame(1));
    const firstPlacement = {} as PlacementLedger;
    const secondPlacement = {} as PlacementLedger;
    await act(async () => root?.render(stage(source, {
      placement: firstPlacement,
      cameraMode: "follow",
      focusRequest: { serial: 9, selection: { kind: "agent", id: "aster" } },
      observedRegionId: "spring",
    })));
    await settle();

    await act(async () => root?.render(stage(source, {
      placement: secondPlacement,
      cameraMode: "follow",
      focusRequest: { serial: 8, selection: { kind: "region", id: "worn" } },
      observedRegionId: "spring",
    })));
    await settle();

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.setCameraMode).toHaveBeenCalledWith("follow");
    expect(second.focusSelection).toHaveBeenCalledOnce();
    expect(second.focusSelection).toHaveBeenCalledWith({ kind: "agent", id: "aster" });
    expect(second.observeRegion).toHaveBeenCalledOnce();
    expect(second.observeRegion).toHaveBeenCalledWith("spring");
  });

  it("silences every observer callback captured from a disposed renderer generation", async () => {
    const first = makeRenderer();
    const second = makeRenderer();
    createRenderer.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const callbacks = {
      onSelectionChange: vi.fn(),
      onBeatActivate: vi.fn(),
      onCameraModeChange: vi.fn(),
      onDiagnostics: vi.fn(),
    };
    const source = makeSource(frame(1));
    await act(async () => root?.render(stage(source, {
      placement: {} as PlacementLedger,
      callbacks,
    })));
    await settle();
    const stale = createRenderer.mock.calls[0]![0].callbacks;

    await act(async () => root?.render(stage(source, {
      placement: {} as PlacementLedger,
      callbacks,
    })));
    await settle();
    stale.onSelectionChange?.({ kind: "region", id: "worn" });
    stale.onBeatActivate?.("old-moment");
    stale.onCameraModeChange?.("free");
    stale.onDiagnostics?.(diagnostics);

    expect(callbacks.onSelectionChange).not.toHaveBeenCalled();
    expect(callbacks.onBeatActivate).not.toHaveBeenCalled();
    expect(callbacks.onCameraModeChange).not.toHaveBeenCalled();
    expect(callbacks.onDiagnostics).not.toHaveBeenCalled();
  });

  it("publishes the exact frame before restoring Follow on every renderer generation", async () => {
    const order: string[] = [];
    const first = acceptanceAwareRenderer("first", order);
    const second = acceptanceAwareRenderer("second", order);
    const firstOptions = deferred<ProductionCanvasSceneRendererOptions>();
    const secondOptions = deferred<ProductionCanvasSceneRendererOptions>();
    createRenderer
      .mockImplementationOnce(async (options) => {
        firstOptions.resolve(options);
        first.bind(options);
        return first.renderer;
      })
      .mockImplementationOnce(async (options) => {
        secondOptions.resolve(options);
        second.bind(options);
        return second.renderer;
      });
    const selected = {
      ...frame(1),
      selection: { kind: "agent", id: "aster" } as const,
    };
    const source = makeSource(selected);
    const onCameraModeRequestRejected = vi.fn();
    const firstPlacement = {} as PlacementLedger;
    const secondPlacement = {} as PlacementLedger;

    await act(async () => root?.render(stage(source, {
      placement: firstPlacement,
      cameraMode: "follow",
      onCameraModeRequestRejected,
    })));
    await settle();
    const staleFirstOptions = await firstOptions.promise;
    expect(order).toEqual(["first:update:1"]);
    expect(container.querySelector(".presentation-world-stage")?.getAttribute("data-ready"))
      .toBe("false");
    expect(onCameraModeRequestRejected).not.toHaveBeenCalled();

    // A real Canvas accepts only after its atlas/scene work finishes. Camera restore must wait.
    await act(async () => first.accept());
    expect(order).toEqual(["first:update:1", "first:camera:follow"]);
    expect(container.querySelector(".presentation-world-stage")?.getAttribute("data-ready"))
      .toBe("true");
    expect(first.renderer.updatePresentation).toHaveBeenCalledOnce();

    await act(async () => root?.render(stage(source, {
      placement: secondPlacement,
      cameraMode: "follow",
      onCameraModeRequestRejected,
    })));
    await settle();
    await secondOptions.promise;
    expect(order).toEqual([
      "first:update:1",
      "first:camera:follow",
      "second:update:1",
    ]);
    expect(container.querySelector(".presentation-world-stage")?.getAttribute("data-ready"))
      .toBe("false");
    await act(async () => second.accept());
    expect(order).toEqual([
      "first:update:1",
      "first:camera:follow",
      "second:update:1",
      "second:camera:follow",
    ]);
    expect(container.querySelector(".presentation-world-stage")?.getAttribute("data-ready"))
      .toBe("true");
    expect(second.renderer.updatePresentation).toHaveBeenCalledOnce();
    expect(onCameraModeRequestRejected).not.toHaveBeenCalled();

    staleFirstOptions.frameAcceptance?.markAccepted({ ...selected, revision: 2 });
    expect(order).toEqual([
      "first:update:1",
      "first:camera:follow",
      "second:update:1",
      "second:camera:follow",
    ]);
    expect(first.renderer.setCameraMode).toHaveBeenCalledOnce();
  });

  it("forwards only semantics matching the exact accepted source frame", async () => {
    const onSemanticSnapshot = vi.fn();
    const source = makeSource(frame(4));
    await act(async () => root?.render(stage(source, { callbacks: { onSemanticSnapshot } })));
    await settle();
    const rendererCallbacks = createRenderer.mock.calls[0]![0].callbacks;
    const exact = createRendererSemanticSnapshot(identityOf(source.getSnapshot()), []);
    rendererCallbacks.onSemanticSnapshot?.(exact);
    rendererCallbacks.onSemanticSnapshot?.(createRendererSemanticSnapshot({
      ...identityOf(source.getSnapshot()), revision: 3,
    }, []));

    expect(onSemanticSnapshot).toHaveBeenCalledOnce();
    expect(onSemanticSnapshot).toHaveBeenCalledWith(exact);
  });

  it("maps Canvas keyboard controls to observer-only camera, region, and exact-moment intents", async () => {
    const renderer = makeRenderer();
    vi.mocked(renderer.setCameraMode).mockImplementation((mode) => {
      createRenderer.mock.calls[0]![0].callbacks.onCameraModeChange?.(mode);
    });
    createRenderer.mockResolvedValue(renderer);
    const selected = { ...frame(2), selection: { kind: "agent", id: "aster" } as const };
    const viewMoment = vi.fn();
    const observeRegion = vi.fn();
    await act(async () => root?.render(stage(makeSource(selected), {
      cameraMode: "free",
      regionOrder: ["worn", "spring"],
      activeMomentId: "moment-2",
      onViewMoment: viewMoment,
      onObserveRegion: observeRegion,
    })));
    await settle();
    const canvas = container.querySelector("canvas")!;
    expect(container.querySelector(".presentation-world-stage")?.tagName).toBe("DIV");
    expect(canvas.getAttribute("aria-describedby")).toBe("world-keyboard-help");
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 }),
    });
    for (const key of ["s", "f", "v", "+", "[", "]", "Home", "End", "m"]) {
      canvas.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }

    expect(renderer.setCameraMode).toHaveBeenCalledWith("story");
    expect(renderer.setCameraMode).toHaveBeenCalledWith("follow");
    expect(renderer.setCameraMode).toHaveBeenCalledWith("free");
    expect(renderer.zoomCamera).toHaveBeenCalledWith(1.25, { x: 200, y: 150 });
    expect(vi.mocked(renderer.observeRegion).mock.calls.map(([id]) => id)).toEqual([
      "spring", "worn", "worn", "spring",
    ]);
    expect(observeRegion.mock.calls.map(([id]) => id)).toEqual([
      "spring", "worn", "worn", "spring",
    ]);
    expect(viewMoment).toHaveBeenCalledOnce();
    expect(viewMoment).toHaveBeenCalledWith("moment-2");
  });

  it("maps every arrow to the grabbed-content pan convention", async () => {
    const renderer = makeRenderer();
    createRenderer.mockResolvedValue(renderer);
    await mount(makeSource(frame(1)));
    const canvas = container.querySelector("canvas")!;

    for (const key of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      canvas.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }

    expect(vi.mocked(renderer.panCamera).mock.calls).toEqual([
      [{ x: -32, y: 0 }],
      [{ x: 32, y: 0 }],
      [{ x: 0, y: 32 }],
      [{ x: 0, y: -32 }],
    ]);
  });

  it("uses two-axis trackpad wheel for pan and control-wheel for pointer-anchored zoom", async () => {
    const renderer = makeRenderer();
    createRenderer.mockResolvedValue(renderer);
    await mount(makeSource(frame(1)));
    const canvas = container.querySelector("canvas")!;
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 40,
        y: 20,
        left: 40,
        top: 20,
        right: 440,
        bottom: 320,
        width: 400,
        height: 300,
      }),
    });

    const pan = new WheelEvent("wheel", {
      deltaX: 10,
      deltaY: -20,
      clientX: 140,
      clientY: 90,
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(pan);
    expect(pan.defaultPrevented).toBe(true);
    expect(renderer.panCamera).toHaveBeenCalledWith({ x: -10, y: 20 });

    const zoom = new WheelEvent("wheel", {
      deltaY: -100,
      ctrlKey: true,
      clientX: 200,
      clientY: 150,
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(true);
    expect(renderer.zoomCamera).toHaveBeenCalledWith(
      expect.closeTo(Math.exp(0.2)),
      { x: 160, y: 130 },
    );
  });

  it("never selects on a drag-pan, however the press started", async () => {
    const renderer = makeRenderer();
    createRenderer.mockResolvedValue(renderer);
    await mount(makeSource(frame(1)));
    const canvas = container.querySelector("canvas")!;
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: setPointerCapture,
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: releasePointerCapture,
    });

    canvas.dispatchEvent(worldPointerEvent("pointerdown", 7, 100, 100));
    expect(document.activeElement).toBe(canvas);
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    // The press alone selects NOTHING. It is still a candidate click at this point, and a press that
    // becomes a pan used to select whatever it started on and pop the Selection drawer over the frame.
    expect(renderer.selectAt).not.toHaveBeenCalled();
    expect(renderer.panCamera).not.toHaveBeenCalled();
    expect(canvas.classList).not.toContain("presentation-world-stage__canvas--dragging");

    canvas.dispatchEvent(worldPointerEvent("pointermove", 7, 115, 90));
    canvas.dispatchEvent(worldPointerEvent("pointermove", 7, 120, 95));
    expect(vi.mocked(renderer.panCamera).mock.calls).toEqual([
      [{ x: 15, y: -10 }],
      [{ x: 5, y: 5 }],
    ]);
    expect(canvas.classList).toContain("presentation-world-stage__canvas--dragging");

    canvas.dispatchEvent(worldPointerEvent("pointerup", 7, 120, 95));
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(canvas.classList).not.toContain("presentation-world-stage__canvas--dragging");
    // The release of a pan is not a click either, so it neither descends nor selects.
    expect(renderer.selectAt).not.toHaveBeenCalled();
    expect(renderer.enterRegionAt).not.toHaveBeenCalled();
  });

  it("delivers a completed stationary click to selection without creating pan state", async () => {
    const renderer = makeRenderer();
    createRenderer.mockResolvedValue(renderer);
    await mount(makeSource(frame(1)));
    const canvas = container.querySelector("canvas")!;
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: setPointerCapture,
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: releasePointerCapture,
    });

    canvas.dispatchEvent(worldPointerEvent("pointerdown", 12, 75, 90));
    expect(renderer.selectAt).not.toHaveBeenCalled();
    canvas.dispatchEvent(worldPointerEvent("pointerup", 12, 75, 90));

    // Selection is the completed click: the release, at the point the press never left.
    expect(renderer.selectAt).toHaveBeenCalledExactlyOnceWith({ x: 75, y: 90 });
    expect(setPointerCapture).toHaveBeenCalledWith(12);
    expect(releasePointerCapture).toHaveBeenCalledWith(12);
    expect(renderer.panCamera).not.toHaveBeenCalled();
    expect(canvas.classList).not.toContain("presentation-world-stage__canvas--dragging");
  });

  it("clears only the matching drag when pointer capture is lost", async () => {
    const renderer = makeRenderer();
    createRenderer.mockResolvedValue(renderer);
    await mount(makeSource(frame(1)));
    const canvas = container.querySelector("canvas")!;
    const releasePointerCapture = vi.fn();
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: releasePointerCapture,
    });

    canvas.dispatchEvent(worldPointerEvent("pointerdown", 8, 40, 40));
    canvas.dispatchEvent(worldPointerEvent("pointermove", 8, 50, 50));
    canvas.dispatchEvent(worldPointerEvent("lostpointercapture", 99, 50, 50));
    canvas.dispatchEvent(worldPointerEvent("pointermove", 8, 60, 60));
    expect(renderer.panCamera).toHaveBeenCalledTimes(2);
    expect(canvas.classList).toContain("presentation-world-stage__canvas--dragging");

    canvas.dispatchEvent(worldPointerEvent("lostpointercapture", 8, 60, 60));
    const callsAfterLoss = vi.mocked(renderer.panCamera).mock.calls.length;
    canvas.dispatchEvent(worldPointerEvent("pointermove", 8, 80, 80));
    expect(renderer.panCamera).toHaveBeenCalledTimes(callsAfterLoss);
    expect(canvas.classList).not.toContain("presentation-world-stage__canvas--dragging");
    expect(releasePointerCapture).not.toHaveBeenCalled();
  });

  it("ends pointer ownership on cancel and unmount", async () => {
    const renderer = makeRenderer();
    createRenderer.mockResolvedValue(renderer);
    await mount(makeSource(frame(1)));
    const canvas = container.querySelector("canvas")!;
    const releasePointerCapture = vi.fn();
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: releasePointerCapture,
    });
    const removeEventListener = vi.spyOn(canvas, "removeEventListener");

    canvas.dispatchEvent(worldPointerEvent("pointerdown", 3, 80, 80));
    canvas.dispatchEvent(worldPointerEvent("pointermove", 3, 90, 90));
    canvas.dispatchEvent(worldPointerEvent("pointercancel", 3, 90, 90));
    const callsAfterCancel = vi.mocked(renderer.panCamera).mock.calls.length;
    canvas.dispatchEvent(worldPointerEvent("pointermove", 3, 120, 120));
    expect(renderer.panCamera).toHaveBeenCalledTimes(callsAfterCancel);
    expect(releasePointerCapture).toHaveBeenCalledWith(3);

    canvas.dispatchEvent(worldPointerEvent("pointerdown", 4, 20, 20));
    await act(async () => root?.unmount());
    root = null;
    expect(releasePointerCapture).toHaveBeenCalledWith(4);
    const callsAfterUnmount = vi.mocked(renderer.panCamera).mock.calls.length;
    canvas.dispatchEvent(worldPointerEvent("pointermove", 4, 50, 50));
    canvas.dispatchEvent(new WheelEvent("wheel", {
      deltaY: 20,
      bubbles: true,
      cancelable: true,
    }));
    expect(renderer.panCamera).toHaveBeenCalledTimes(callsAfterUnmount);
    expect(removeEventListener).toHaveBeenCalledWith(
      "lostpointercapture",
      expect.any(Function),
    );
  });

  describe("world-view navigation", () => {
    it("holds a sub-dead-zone press as a click and descends into the region on release", async () => {
      const renderer = makeRenderer();
      createRenderer.mockResolvedValue(renderer);
      await mount(makeSource(frame(1)));
      const canvas = container.querySelector("canvas")!;

      canvas.dispatchEvent(worldPointerEvent("pointerdown", 21, 100, 100));
      // Two pixels of trackpad jitter: a click, not a pan.
      canvas.dispatchEvent(worldPointerEvent("pointermove", 21, 101, 102));
      expect(renderer.panCamera).not.toHaveBeenCalled();
      canvas.dispatchEvent(worldPointerEvent("pointerup", 21, 101, 102));

      expect(renderer.enterRegionAt).toHaveBeenCalledTimes(1);
      expect(vi.mocked(renderer.enterRegionAt!).mock.calls[0]![0]).toEqual({ x: 101, y: 102 });
    });

    it("pans from the press ORIGIN once the dead zone is crossed, and never descends", async () => {
      const renderer = makeRenderer();
      createRenderer.mockResolvedValue(renderer);
      await mount(makeSource(frame(1)));
      const canvas = container.querySelector("canvas")!;

      canvas.dispatchEvent(worldPointerEvent("pointerdown", 22, 100, 100));
      canvas.dispatchEvent(worldPointerEvent("pointermove", 22, 102, 100));
      canvas.dispatchEvent(worldPointerEvent("pointermove", 22, 130, 90));
      canvas.dispatchEvent(worldPointerEvent("pointerup", 22, 130, 90));

      expect(vi.mocked(renderer.panCamera).mock.calls).toEqual([[{ x: 30, y: -10 }]]);
      expect(renderer.enterRegionAt).not.toHaveBeenCalled();
    });

    it("forwards a hover with no press, and clears it when the pointer leaves", async () => {
      const renderer = makeRenderer();
      createRenderer.mockResolvedValue(renderer);
      await mount(makeSource(frame(1)));
      const canvas = container.querySelector("canvas")!;

      canvas.dispatchEvent(worldPointerEvent("pointermove", 23, 240, 160));
      expect(vi.mocked(renderer.hoverAt!).mock.calls.at(-1)?.[0]).toEqual({ x: 240, y: 160 });

      canvas.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
      expect(vi.mocked(renderer.hoverAt!).mock.calls.at(-1)?.[0]).toBeNull();
    });

    it("does not hover while a drag is in progress", async () => {
      const renderer = makeRenderer();
      createRenderer.mockResolvedValue(renderer);
      await mount(makeSource(frame(1)));
      const canvas = container.querySelector("canvas")!;

      canvas.dispatchEvent(worldPointerEvent("pointerdown", 24, 100, 100));
      canvas.dispatchEvent(worldPointerEvent("pointermove", 24, 200, 200));

      expect(renderer.hoverAt).not.toHaveBeenCalled();
    });

    it("leaves the region on Escape", async () => {
      const renderer = makeRenderer();
      createRenderer.mockResolvedValue(renderer);
      await mount(makeSource(frame(1)));
      const canvas = container.querySelector("canvas")!;

      canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      expect(renderer.exitToWorldView).toHaveBeenCalledTimes(1);
    });

    it("leaves the region on Escape before anything in the stage has been touched", async () => {
      const renderer = makeRenderer();
      createRenderer.mockResolvedValue(renderer);
      await mount(makeSource(frame(1)));

      // Nothing has been clicked, so the canvas does not hold keyboard focus. A way out that only
      // works after a mouse gesture is not a keyboard affordance.
      expect(document.activeElement).not.toBe(container.querySelector("canvas"));
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      expect(renderer.exitToWorldView).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["an open modal", { "aria-modal": "true" }],
      ["a drawer a trigger reports as expanded", { "aria-controls": "surface", "aria-expanded": "true" }],
    ])("leaves Escape to %s even while the canvas holds focus", async (_label, attributes) => {
      const renderer = makeRenderer();
      createRenderer.mockResolvedValue(renderer);
      await mount(makeSource(frame(1)));
      const canvas = container.querySelector("canvas")!;
      const surface = document.createElement("div");
      for (const [name, value] of Object.entries(attributes)) surface.setAttribute(name, value);
      document.body.append(surface);

      try {
        canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(renderer.exitToWorldView).not.toHaveBeenCalled();
      } finally {
        surface.remove();
      }
    });

    it("reports the region the viewer flew into, and reports nothing from the world view", async () => {
      const renderer = makeRenderer();
      let published: ProductionCanvasSceneRendererOptions | null = null;
      createRenderer.mockImplementation(async (options) => {
        published = options;
        return renderer;
      });
      const observed: string[] = [];
      await act(async () => root?.render(stage(makeSource(frame(1)), {
        onObserveRegion: (regionId) => observed.push(regionId),
      })));
      await settle();

      const navigation = (scope: "world" | "region", regionId: string) => ({
        scope,
        regionId,
        regionName: regionId,
        hoveredRegionId: null,
        hoveredRegionName: null,
        hoveredPopulation: null,
        hoveredHomes: null,
        exitOffered: false,
      } as const);

      // At world scope the viewer is above the whole archipelago and has chosen no place, so the
      // shell is told nothing -- the chrome must not start renaming itself as the camera drifts.
      await act(async () => published!.callbacks.onWorldNavigationChange?.(navigation("world", "worn")));
      expect(observed).toEqual([]);

      // Landing inside one is the choice, and it is what the chrome has to name: without this the
      // shell kept naming the STORY's region while the badge named the viewer's, on screen together.
      await act(async () => published!.callbacks.onWorldNavigationChange?.(navigation("region", "worn")));
      expect(observed).toEqual(["worn"]);

      // Steady state inside the same region says it once, not once a frame.
      await act(async () => published!.callbacks.onWorldNavigationChange?.(navigation("region", "worn")));
      expect(observed).toEqual(["worn"]);
      expect(renderer.observeRegion).not.toHaveBeenCalled();
    });

    it("shows the explicit way out only while inside a region, and offers the step-out at the floor", async () => {
      const renderer = makeRenderer();
      let published: ProductionCanvasSceneRendererOptions | null = null;
      createRenderer.mockImplementation(async (options) => {
        published = options;
        return renderer;
      });
      await mount(makeSource(frame(1)));
      const canvas = container.querySelector("canvas")!;
      expect(container.querySelector(".presentation-world-stage__region-exit")).toBeNull();

      await act(async () => {
        published!.callbacks.onWorldNavigationChange?.({
          scope: "region",
          regionId: "worn",
          regionName: "Worn",
          hoveredRegionId: null,
          hoveredRegionName: null,
          hoveredPopulation: null,
          hoveredHomes: null,
          exitOffered: false,
        });
      });
      const badge = container.querySelector(".presentation-world-stage__region-exit")!;
      expect(badge.textContent).toContain("Inside Worn");
      expect(badge.getAttribute("data-exit-offered")).toBe("false");

      await act(async () => {
        published!.callbacks.onWorldNavigationChange?.({
          scope: "region",
          regionId: "worn",
          regionName: "Worn",
          hoveredRegionId: null,
          hoveredRegionName: null,
          hoveredPopulation: null,
          hoveredHomes: null,
          exitOffered: true,
        });
      });
      const offered = container.querySelector(".presentation-world-stage__region-exit")!;
      expect(offered.textContent).toContain("Zoom out again to leave Worn");
      expect(offered.getAttribute("data-exit-offered")).toBe("true");

      await act(async () => {
        offered.querySelector("button")!.click();
      });
      expect(renderer.exitToWorldView).toHaveBeenCalledTimes(1);

      await act(async () => {
        published!.callbacks.onWorldNavigationChange?.({
          scope: "world",
          regionId: "worn",
          regionName: "Worn",
          hoveredRegionId: "spring",
          hoveredRegionName: "Spring",
          hoveredPopulation: 4,
          hoveredHomes: 2,
          exitOffered: false,
        });
      });
      expect(container.querySelector(".presentation-world-stage__region-exit")).toBeNull();
      expect(canvas.classList).toContain("presentation-world-stage__canvas--over-island");
      expect(container.firstElementChild?.getAttribute("data-world-scope")).toBe("world");
      expect(container.firstElementChild?.getAttribute("data-hovered-region")).toBe("spring");

      await act(async () => {
        published!.callbacks.onWorldNavigationChange?.({
          scope: "world",
          regionId: "worn",
          regionName: "Worn",
          hoveredRegionId: null,
          hoveredRegionName: null,
          hoveredPopulation: null,
          hoveredHomes: null,
          exitOffered: false,
        });
      });
      expect(canvas.classList).not.toContain("presentation-world-stage__canvas--over-island");
    });
  });
});

function acceptanceAwareRenderer(label: string, order: string[]) {
  const renderer = makeRenderer();
  let options: ProductionCanvasSceneRendererOptions | null = null;
  let acceptedFrame: PresentedObserverFrame | null = null;
  let pendingFrame: PresentedObserverFrame | null = null;
  vi.mocked(renderer.updatePresentation).mockImplementation((next) => {
    order.push(`${label}:update:${next.revision}`);
    pendingFrame = next;
  });
  vi.mocked(renderer.setCameraMode).mockImplementation((mode) => {
    order.push(`${label}:camera:${mode}`);
    if (mode !== "follow" || acceptedFrame?.selection?.kind === "agent"
      || acceptedFrame?.selection?.kind === "home") {
      options?.callbacks.onCameraModeChange?.(mode);
    }
  });
  return {
    renderer,
    bind(next: ProductionCanvasSceneRendererOptions): void { options = next; },
    accept(): void {
      if (pendingFrame === null) throw new Error("No frame is pending acceptance.");
      acceptedFrame = pendingFrame;
      pendingFrame = null;
      options?.frameAcceptance?.markAccepted(acceptedFrame);
    },
  };
}

function stage(
  frameSource: PresentationFrameSource,
  options: Readonly<{
    safeFrame?: SafeFrameInsets;
    reducedMotion?: boolean;
    callbacks?: Parameters<typeof PresentationWorldStage>[0]["callbacks"];
    frameAcceptance?: Parameters<typeof PresentationWorldStage>[0]["frameAcceptance"];
    onSceneSignals?: Parameters<typeof PresentationWorldStage>[0]["onSceneSignals"];
    placement?: PlacementLedger;
    cameraMode?: CameraMode;
    focusRequest?: Readonly<{ serial: number; selection: Exclude<ObserverSelection, null> }> | null;
    observedRegionId?: string | null;
    onCameraModeRequestRejected?: (mode: CameraMode) => void;
    resumeStorySerial?: number;
    regionOrder?: readonly string[];
    activeMomentId?: string | null;
    onViewMoment?: (momentId: string) => void;
    onObserveRegion?: (regionId: string) => void;
    atlasPool?: SharedAtlasPool;
    atlasCommitScheduler?: AtlasCommitScheduler;
  }> = {},
) {
  return (
    <PresentationWorldStage
      frameSource={frameSource}
      placement={options.placement ?? placement}
      recipes={recipes}
      safeFrame={options.safeFrame}
      reducedMotion={options.reducedMotion}
      callbacks={options.callbacks}
      frameAcceptance={options.frameAcceptance}
      onSceneSignals={options.onSceneSignals}
      cameraMode={options.cameraMode}
      focusRequest={options.focusRequest}
      observedRegionId={options.observedRegionId}
      onCameraModeRequestRejected={options.onCameraModeRequestRejected}
      resumeStorySerial={options.resumeStorySerial}
      regionOrder={options.regionOrder}
      activeMomentId={options.activeMomentId}
      onViewMoment={options.onViewMoment}
      onObserveRegion={options.onObserveRegion}
      atlasPool={options.atlasPool}
      atlasCommitScheduler={options.atlasCommitScheduler}
    />
  );
}

async function mount(source: PresentationFrameSource): Promise<void> {
  await act(async () => root?.render(stage(source)));
  await settle();
}

function makeSource(initial: PresentedObserverFrame, order?: string[]) {
  let current = initial;
  const listeners = new Set<() => void>();
  const unsubscribe = vi.fn((listener: () => void) => {
    order?.push("unsubscribe");
    listeners.delete(listener);
  });
  const source = {
    getSnapshot: vi.fn(() => current),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => unsubscribe(listener);
    }),
    unsubscribe,
    publish(next: PresentedObserverFrame): void {
      current = next;
      [...listeners].forEach((listener) => listener());
    },
  };
  return source;
}

/**
 * Gives the canvas a real box, because jsdom lays nothing out.
 *
 * `wheelNavigationIntent` refuses an input whose viewport is zero-sized, so
 * without this a dispatched wheel event is silently inert and a test that
 * believes it zoomed proves nothing.
 */
function givenCanvasBounds(width = 1_200, height = 800): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height,
    toJSON: () => ({}),
  } as DOMRect);
}

function makeRenderer(order?: string[]): ObserverRendererPort {
  return {
    updatePresentation: vi.fn((next: PresentedObserverFrame) => {
      createRenderer.mock.calls.at(-1)?.[0].frameAcceptance?.markAccepted(next);
    }),
    setSelection: vi.fn(),
    focusSelection: vi.fn(),
    observeRegion: vi.fn(),
    setSafeFrame: vi.fn(),
    setCameraMode: vi.fn(),
    panCamera: vi.fn(),
    zoomCamera: vi.fn(),
    resize: vi.fn(),
    diagnostics: vi.fn(() => diagnostics),
    dispose: vi.fn(() => order?.push("dispose")),
    hoverAt: vi.fn(),
    enterRegionAt: vi.fn(),
    exitToWorldView: vi.fn(),
    selectAt: vi.fn(),
  };
}

const diagnostics = {
  disposed: false,
  frameIdentity: null,
  drawP95Ms: 0,
  scheduledFrame: false,
  activeActors: 0,
  activeHomes: 0,
  activeEffects: 0,
  staticLayerRebuilds: 0,
  assetBytes: 0,
  decodedAssetBytes: 0,
  pathFallbacks: 0,
} as const;

function frame(revision: number, sourceKey = "live:run-one"): PresentedObserverFrame {
  return {
    runId: "run-one",
    sourceKey,
    revision,
    firstCursor: revision,
    lastCursor: revision,
    source: sourceKey.startsWith("archive") ? "archive" : "live",
    ingestedCursor: revision,
    presentedCursor: revision,
    world: {
      exactBaseCursor: revision,
      projectedThroughCursor: revision,
      worldTime: revision,
      agents: [],
      regions: [{ completeness: "exact", value: regionValue }],
      homes: [],
      ruins: [],
      pendingProposals: [],
    },
    scene: {
      momentId: `moment-${revision}`,
      regionId: "worn",
      phase: "hold",
      focus: { kind: "system", regionId: "worn" },
      dialogue: null,
      actorIntents: [],
      homeIntents: [],
      effectIntents: [],
      safeCancelMarkers: [],
      reducedMotion: false,
    },
    selection: null,
    backlog: {
      pendingMoments: 0,
      firstPendingCursor: null,
      lastPendingCursor: null,
      state: "caught-up",
      label: "Caught up",
    },
    transport: { connection: "live", ingestedCursor: revision, retryable: true },
  };
}

function identityOf(value: PresentedObserverFrame) {
  return {
    runId: value.runId,
    sourceKey: value.sourceKey,
    revision: value.revision,
    firstCursor: value.firstCursor,
    lastCursor: value.lastCursor,
  };
}

class ResizeObserverFake {
  static instances: ResizeObserverFake[] = [];
  readonly disconnect = vi.fn(() => this.onDisconnect?.());
  onDisconnect: (() => void) | undefined;
  #connected = true;

  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverFake.instances.push(this);
  }

  observe(): void { this.#connected = true; }
  unobserve(): void {}
  emit(width: number, height: number): void {
    if (!this.#connected || this.disconnect.mock.calls.length > 0) return;
    this.callback([{
      contentRect: { width, height } as DOMRectReadOnly,
    } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function worldPointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel" | "lostpointercapture",
  pointerId: number,
  clientX: number,
  clientY: number,
): PointerEvent {
  return new PointerEvent(type, {
    pointerId,
    clientX,
    clientY,
    button: 0,
    isPrimary: true,
    bubbles: true,
    cancelable: true,
  });
}
