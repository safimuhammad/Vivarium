import { lazy, Suspense, useCallback, useEffect, useState, type ReactElement } from "react";

import { parseRendererMode } from "./rendererMode";
import type { Vivarium2DAppProps } from "./Vivarium2DApp";
import type { RunLifecycleCapability } from "./observer2d/runStopController";

const LazyCanvasWorldStage = lazy(async () => {
  const module = await import("../renderer2d/CanvasWorldStage");
  return { default: module.CanvasWorldStage };
});

const LazyLivingAtlasApp = lazy(async () => {
  const module = await import("./LivingAtlasApp");
  return { default: module.LivingAtlasApp };
});

/**
 * Permission to end the run this route is watching, granted by the route.
 *
 * The observer cannot reach the server by itself — its import closure is proved
 * free of every request verb and endpoint — so whoever mounts it is what hands
 * the capability down. The gateway does this for the observer it starts; this is
 * the deep-link route (`?renderer=2d`) doing it too, so a viewer who opens the
 * world directly is not left with a run they cannot stop.
 *
 * The client is imported at CALL time, not at route time: it costs the route
 * nothing until a viewer actually asks to end a run, and it keeps the mounting
 * path a single dynamic import.
 */
const routeRunLifecycle: RunLifecycleCapability = {
  async stop() {
    const { createHttpRunLifecycleClient } = await import("./gateway/runLifecycleClient");
    return createHttpRunLifecycleClient().stop();
  },
  async getLifecycle() {
    const { createHttpRunLifecycleClient } = await import("./gateway/runLifecycleClient");
    return createHttpRunLifecycleClient().getLifecycle();
  },
};

const LazyVivarium2DApp = lazy(async () => {
  const observer = await import("./Vivarium2DApp");
  const RoutedObserver = (props: Vivarium2DAppProps): ReactElement => (
    <observer.Vivarium2DApp runLifecycle={routeRunLifecycle} {...props} />
  );
  return { default: RoutedObserver };
});

const LazyGatewayApp = lazy(async () => {
  const module = await import("./gateway/GatewayApp");
  return { default: module.GatewayApp };
});

export interface AppProps {
  readonly production2dProps?: Vivarium2DAppProps;
}

export function App({ production2dProps }: AppProps = {}) {
  const [search, setSearch] = useState(() => window.location.search);
  useEffect(() => {
    const readRoute = (): void => setSearch(window.location.search);
    window.addEventListener("popstate", readRoute);
    return () => window.removeEventListener("popstate", readRoute);
  }, []);
  /**
   * Where a deep-linked viewer goes when the run they were watching has ended.
   *
   * The gateway needs nothing like this: its live world is a state inside it and
   * the URL never left `/`, so it simply goes back to its own way in. This route
   * is the one place a live world genuinely IS a route, so returning is a real
   * navigation — and the honest one is to stop naming the renderer, which lands
   * the viewer on whatever `/` serves. Everything else the deep link said is
   * kept, so a viewer who came in at a seam comes back to the way in at that
   * same seam.
   *
   * `replaceState`, because the entry it replaces names a run that no longer
   * exists — a Back button that returns to a world that has ended is a dead
   * link, not a way back. Nothing calls this on a surface with no run to end:
   * fixtures, recordings and the capture harness are granted no stop capability
   * and never report an ending.
   */
  const returnToGateway = useCallback((): void => {
    const url = new URL(window.location.href);
    url.searchParams.delete("renderer");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    setSearch(window.location.search);
  }, []);
  const mode = parseRendererMode(search);
  if (mode === "2d-slice") {
    return (
      <Suspense fallback={<main aria-label="Loading 2D world" />}>
        <LazyCanvasWorldStage />
      </Suspense>
    );
  }
  if (mode === "2d") {
    return (
      <Suspense fallback={<main aria-label="Loading production 2D world" />}>
        <LazyVivarium2DApp onRunEnded={returnToGateway} {...production2dProps} />
      </Suspense>
    );
  }
  if (mode === "living-atlas") {
    return (
      <Suspense fallback={<main aria-label="Loading Living Atlas" />}>
        <LazyLivingAtlasApp />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<main aria-label="Loading Vivarium" />}>
      <LazyGatewayApp />
    </Suspense>
  );
}
