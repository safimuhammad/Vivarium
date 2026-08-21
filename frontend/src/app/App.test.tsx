import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.resetModules();
  window.history.replaceState({}, "", "/");
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
  vi.resetModules();
});

async function renderApp(search: string) {
  window.history.replaceState({}, "", `/${search}`);
  const livingImport = vi.fn();
  const sliceImport = vi.fn();
  const productionImport = vi.fn();
  const gatewayImport = vi.fn();
  vi.doMock("./LivingAtlasApp", () => {
    livingImport();
    return { LivingAtlasApp: () => <main data-testid="living-atlas" /> };
  });
  vi.doMock("../renderer2d/CanvasWorldStage", () => {
    sliceImport();
    return { CanvasWorldStage: () => <main data-testid="vivarium-2d-slice" /> };
  });
  vi.doMock("./Vivarium2DApp", () => {
    productionImport();
    return { Vivarium2DApp: () => <main data-testid="vivarium-2d-production" /> };
  });
  vi.doMock("./gateway/GatewayApp", () => {
    gatewayImport();
    return { GatewayApp: () => <main data-testid="gateway" /> };
  });
  const { App } = await import("./App");
  root = createRoot(container as HTMLDivElement);
  await act(async () => root?.render(<App />));
  return { livingImport, sliceImport, productionImport, gatewayImport };
}

describe("App renderer boundary", () => {
  it("mounts only the 2d slice for the exact route", async () => {
    const imports = await renderApp("?renderer=2d-slice");

    expect(container?.querySelector('[data-testid="vivarium-2d-slice"]')).not.toBeNull();
    expect(imports.sliceImport).toHaveBeenCalledOnce();
    expect(imports.livingImport).not.toHaveBeenCalled();
    expect(imports.productionImport).not.toHaveBeenCalled();
    expect(imports.gatewayImport).not.toHaveBeenCalled();
  });

  it("mounts only the production 2d observer for the exact route", async () => {
    const imports = await renderApp("?renderer=2d");

    expect(container?.querySelector('[data-testid="vivarium-2d-production"]')).not.toBeNull();
    expect(imports.productionImport).toHaveBeenCalledOnce();
    expect(imports.sliceImport).not.toHaveBeenCalled();
    expect(imports.livingImport).not.toHaveBeenCalled();
    expect(imports.gatewayImport).not.toHaveBeenCalled();
  });

  // The default route is the way in — the landing page and the configuration
  // screen — because it leads into the chronicle-validated 2D observer. It used
  // to mount the Living Atlas, which meant anyone who arrived at "/" and pressed
  // live got the unvalidated stack.
  it.each(["", "?renderer=unknown"])(
    "mounts the gateway for %s",
    async (search) => {
      const imports = await renderApp(search);

      expect(container?.querySelector('[data-testid="gateway"]')).not.toBeNull();
      expect(imports.gatewayImport).toHaveBeenCalledOnce();
      expect(imports.livingImport).not.toHaveBeenCalled();
      expect(imports.sliceImport).not.toHaveBeenCalled();
      expect(imports.productionImport).not.toHaveBeenCalled();
    },
  );

  it("still mounts Living Atlas when it is asked for by name", async () => {
    const imports = await renderApp("?renderer=living-atlas");

    expect(container?.querySelector('[data-testid="living-atlas"]')).not.toBeNull();
    expect(imports.livingImport).toHaveBeenCalledOnce();
    expect(imports.gatewayImport).not.toHaveBeenCalled();
    expect(imports.sliceImport).not.toHaveBeenCalled();
    expect(imports.productionImport).not.toHaveBeenCalled();
  });

  // Regression: `?source=event-demo` is the public, no-backend-required demo
  // route (a canned deterministic event stream `LivingAtlasApp` already knows
  // how to read). It names no renderer, so before `parseRendererMode` learned
  // about the source param this fell through every branch to the gateway and
  // `window.__vivariumWorld` was never published — the demo/tour route hung.
  it("mounts Living Atlas for the public event-demo route, without naming a renderer", async () => {
    const imports = await renderApp("?source=event-demo");

    expect(container?.querySelector('[data-testid="living-atlas"]')).not.toBeNull();
    expect(imports.livingImport).toHaveBeenCalledOnce();
    expect(imports.gatewayImport).not.toHaveBeenCalled();
    expect(imports.sliceImport).not.toHaveBeenCalled();
    expect(imports.productionImport).not.toHaveBeenCalled();
  });

  it("disposes the selected renderer route before the next surface claims ownership", async () => {
    const trace: string[] = [];
    let productionGeneration = 0;
    vi.doMock("./Vivarium2DApp", () => ({
      Vivarium2DApp: () => {
        useEffect(() => {
          productionGeneration += 1;
          const generation = productionGeneration;
          const onFrame = (): void => { trace.push(`frame-callback:${generation}`); };
          trace.push("surface-claim:2d");
          window.addEventListener("vivarium-test-frame", onFrame);
          return () => {
            trace.push("old-source-unsubscribe");
            window.removeEventListener("vivarium-test-frame", onFrame);
            trace.push("old-renderer-dispose");
            trace.push("old-surface-release");
          };
        }, []);
        return <main data-testid="vivarium-2d-production" />;
      },
    }));
    vi.doMock("./LivingAtlasApp", () => ({
      LivingAtlasApp: () => {
        useEffect(() => {
          trace.push("new-surface-claim:living-atlas");
        }, []);
        return <main data-testid="living-atlas" />;
      },
    }));
    vi.doMock("../renderer2d/CanvasWorldStage", () => ({
      CanvasWorldStage: () => <main data-testid="vivarium-2d-slice" />,
    }));
    window.history.replaceState({}, "", "/?renderer=2d");
    const { App } = await import("./App");
    root = createRoot(container as HTMLDivElement);
    await act(async () => root?.render(<App />));
    window.dispatchEvent(new Event("vivarium-test-frame"));

    window.history.pushState({}, "", "/?renderer=living-atlas");
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    window.dispatchEvent(new Event("vivarium-test-frame"));

    expect(container?.querySelector('[data-testid="living-atlas"]')).not.toBeNull();
    expect(trace.filter((entry) => entry.startsWith("frame-callback:"))).toEqual([
      "frame-callback:1",
    ]);
    expect(trace.indexOf("old-source-unsubscribe"))
      .toBeLessThan(trace.indexOf("old-renderer-dispose"));
    expect(trace.indexOf("old-renderer-dispose"))
      .toBeLessThan(trace.indexOf("old-surface-release"));
    expect(trace.indexOf("old-surface-release"))
      .toBeLessThan(trace.indexOf("new-surface-claim:living-atlas"));

    window.history.pushState({}, "", "/?renderer=2d");
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    window.dispatchEvent(new Event("vivarium-test-frame"));
    expect(container?.querySelector('[data-testid="vivarium-2d-production"]')).not.toBeNull();
    expect(trace.filter((entry) => entry === "surface-claim:2d")).toHaveLength(2);
    expect(trace.filter((entry) => entry.startsWith("frame-callback:"))).toEqual([
      "frame-callback:1",
      "frame-callback:2",
    ]);
  });
});
