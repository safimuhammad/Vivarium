import { lazy, Suspense, useEffect, useState } from "react";

import { parseRendererMode } from "./rendererMode";
import type { Vivarium2DAppProps } from "./Vivarium2DApp";

const LazyCanvasWorldStage = lazy(async () => {
  const module = await import("../renderer2d/CanvasWorldStage");
  return { default: module.CanvasWorldStage };
});

const LazyLivingAtlasApp = lazy(async () => {
  const module = await import("./LivingAtlasApp");
  return { default: module.LivingAtlasApp };
});

const LazyVivarium2DApp = lazy(async () => {
  const module = await import("./Vivarium2DApp");
  return { default: module.Vivarium2DApp };
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
        <LazyVivarium2DApp {...production2dProps} />
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
