/**
 * Viewable pilot page for the three Nirvana West compositions.
 *
 * Sibling of `warmSpringsPilot/viewer/WarmSpringsPilotViewer.tsx` and
 * `nirvanaEastPilot/viewer/NirvanaEastPilotViewer.tsx`: a viewer for choosing
 * a design by eye, not a product. It paints the real pilot scene through the
 * real pilot painter (`createNirvanaWestFullPaintPlan` / `renderNirvanaWestFullPlan`,
 * which in turn run on the PRODUCTION static-scene primitives), so what is on
 * screen is the same pixels the offline plates write rather than a second
 * rendering path that could disagree with them.
 *
 * Controls: composition switch (A/B/C, default B — Ember Rift), a
 * walkability overlay toggle, a shelter-plot overlay toggle, an "animate"
 * toggle driving the animated environment layer (fire/smoke/heat-haze) off a
 * `requestAnimationFrame` clock, a "reduced motion" toggle that freezes every
 * placement at its seeded still, drag-to-pan with wheel zoom, and a live
 * readout of plot cost / identity-in-view / causeway axis mix / the plot-cost
 * demotion count / the torus seam report / the animated environment counts.
 *
 * Performance note: the static terrain+scenery picture (plus the blocked-
 * ground/shelter-plot overlays) is expensive to rasterise (tens of thousands
 * of `drawImage` calls) but does not change between animation frames, so it
 * is rendered exactly once per composition/overlay change into an OFFSCREEN
 * canvas cached in `staticCanvasRef`. Every animation frame only blits that
 * cached bitmap (one `drawImage` call) and then redraws the animated
 * placements through `renderNirvanaWestFullPlan` with an EMPTY static
 * operations list, so the same production draw path resolves the animated
 * layer without re-rasterising anything static.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import {
  createNirvanaWestFullPaintPlan,
  renderNirvanaWestFullPlan,
  renderNirvanaWestPlan,
  type CompactNirvanaWestAtlasManifest,
  type NirvanaWestPaintPlan,
} from "../nirvanaWestPainter";
import {
  NIRVANA_WEST_COMPOSITION_IDS,
  NIRVANA_WEST_RUIN_KITS,
  animatedEnvironmentReport,
  createNirvanaWestScene,
  verifyToroidalSeam,
  type NirvanaWestCompositionId,
  type NirvanaWestRuinKit,
  type NirvanaWestScene,
} from "../nirvanaWestScene";
import { identityVisibilityReport, shelterPlotReport } from "../nirvanaWestWalkability";
import manifest from "../assets/atlas.json";
import terrainUrl from "../assets/terrain.png";
import sceneryUrl from "../assets/scenery.png";
import environmentUrl from "../assets/environment.png";

const LABELS: Readonly<Record<NirvanaWestCompositionId, string>> = {
  "a-ashfall-drifts": "A — Ashfall Drifts",
  "b-ember-rift": "B — Ember Rift",
  "c-shattered-pavement": "C — Shattered Pavement",
};

interface AtlasSources {
  readonly terrain: HTMLImageElement;
  readonly scenery: HTMLImageElement;
  readonly environment: HTMLImageElement;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = (): void => resolve(image);
    image.onerror = (): void => reject(new Error(`Could not load ${source}`));
    image.src = source;
  });
}

export function NirvanaWestPilotViewer(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [composition, setComposition] = useState<NirvanaWestCompositionId>("b-ember-rift");
  // The lore question, switchable by eye: "ancient" reads as catastrophic and
  // dead without asserting an industrial past; "industrial" is stronger and
  // makes a claim about this world that nothing in the simulation has made.
  const [ruinKit, setRuinKit] = useState<NirvanaWestRuinKit>("ancient");
  const [showBlocked, setShowBlocked] = useState(false);
  const [showPlots, setShowPlots] = useState(false);
  const [animate, setAnimate] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [zoom, setZoom] = useState(0.28);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [sources, setSources] = useState<AtlasSources | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([loadImage(terrainUrl), loadImage(sceneryUrl), loadImage(environmentUrl)]).then(
      ([terrain, scenery, environment]) => {
        if (live) setSources({ terrain, scenery, environment });
      },
    );
    return (): void => { live = false; };
  }, []);

  const scene: NirvanaWestScene = useMemo(
    () => createNirvanaWestScene(composition, ruinKit),
    [composition, ruinKit],
  );
  const plots = useMemo(() => shelterPlotReport(scene), [scene]);
  const visibility = useMemo(() => identityVisibilityReport(scene), [scene]);
  const seam = useMemo(() => verifyToroidalSeam(scene), [scene]);
  const animatedReport = useMemo(() => animatedEnvironmentReport(scene), [scene]);

  const causewaysByAxis = useMemo(() => {
    const byAxis: Record<string, number> = { "east-west": 0, "north-south": 0 };
    for (const causeway of scene.causeways) {
      byAxis[causeway.axis] = (byAxis[causeway.axis] ?? 0) + 1;
    }
    return byAxis;
  }, [scene]);

  // The full plan (static geometry + resolved animated operations) is cheap
  // to BUILD (it is only draw-op records, no rasterising) and does not depend
  // on the atlas images having loaded yet, so it is memoised on the scene alone.
  const fullPlan: NirvanaWestPaintPlan = useMemo(
    () => createNirvanaWestFullPaintPlan(scene, manifest as unknown as CompactNirvanaWestAtlasManifest),
    [scene],
  );

  // A plan with the SAME animated operations but an EMPTY static operations
  // list - passing this to `renderNirvanaWestFullPlan` every animation frame
  // draws only the animated layer (via the real production draw primitive)
  // without re-rasterising the static picture each of those calls walks over.
  const animatedOnlyPlan: NirvanaWestPaintPlan = useMemo(
    () => ({ plan: { cacheIdentity: fullPlan.plan.cacheIdentity, operations: [] }, animated: fullPlan.animated }),
    [fullPlan],
  );

  // Rasterise the static picture (terrain + scenery + emberwisp pass, plus
  // the blocked-ground / shelter-plot overlays) exactly once per composition
  // or overlay-toggle change, into an offscreen canvas cached across frames.
  useEffect(() => {
    if (sources === null) return;
    let offscreen = staticCanvasRef.current;
    if (offscreen === null) {
      offscreen = document.createElement("canvas");
      staticCanvasRef.current = offscreen;
    }
    offscreen.width = scene.widthPixels;
    offscreen.height = scene.heightPixels;
    const context = offscreen.getContext("2d");
    if (context === null) return;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, offscreen.width, offscreen.height);
    // STATIC only - deliberately not `renderNirvanaWestFullPlan`, which would also
    // bake one animated phase per placement into this cache. Baking animated pixels
    // here would double-expose: the live per-frame redraw below alpha-blends its own
    // (semi-transparent) sprite on top of whatever is already in the destination
    // rect, so a baked-in frame would show through at every edge the live frame
    // doesn't fully cover. The animated layer is drawn ONLY live, every frame.
    renderNirvanaWestPlan(context, fullPlan.plan, sources, { x: 0, y: 0 });

    if (showBlocked) {
      context.fillStyle = "rgba(226, 62, 54, 0.42)";
      for (let row = 0; row < scene.rows; row += 1) {
        for (let column = 0; column < scene.columns; column += 1) {
          if (scene.collision[row * scene.columns + column] !== 1) continue;
          context.fillRect(
            column * scene.tileSize, row * scene.tileSize, scene.tileSize, scene.tileSize,
          );
        }
      }
    }
    if (showPlots) {
      for (const status of plots.statuses) {
        // The real 128x128 shelter render rect starts at the plot tile's CENTRE.
        const x = status.plot.tile.column * scene.tileSize + scene.tileSize / 2;
        const y = status.plot.tile.row * scene.tileSize + scene.tileSize / 2;
        context.strokeStyle = status.clear ? "#68e880" : "#ff483c";
        context.lineWidth = status.clear ? 2 : 5;
        context.strokeRect(x, y, 128, 128);
      }
    }

    const main = canvasRef.current;
    if (main !== null) {
      main.width = scene.widthPixels;
      main.height = scene.heightPixels;
    }
  }, [scene, sources, fullPlan, showBlocked, showPlots, plots]);

  // The animation loop: blit the cached static bitmap, then redraw only the
  // animated placements at the current phase. Restarts (cheap - cancel then
  // re-request) whenever anything that changes what should be on screen
  // changes, so a static-only redraw (e.g. toggling an overlay) still shows
  // up immediately even while `animate` is off.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || sources === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;

    const draw = (nowMs: number): void => {
      const staticBitmap = staticCanvasRef.current;
      context.imageSmoothingEnabled = false;
      if (staticBitmap !== null) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(staticBitmap, 0, 0);
      }
      renderNirvanaWestFullPlan(context, animatedOnlyPlan, sources, { x: 0, y: 0 }, nowMs, reducedMotion);
    };

    if (!animate) {
      draw(0);
      return;
    }
    let frameId = requestAnimationFrame(function tick(timestamp: number): void {
      draw(timestamp);
      frameId = requestAnimationFrame(tick);
    });
    return (): void => cancelAnimationFrame(frameId);
  }, [sources, animatedOnlyPlan, animate, reducedMotion, showBlocked, showPlots, plots]);

  const onWheel = useCallback((event: React.WheelEvent<HTMLDivElement>): void => {
    setZoom((current) => Math.min(2, Math.max(0.08, current * (event.deltaY < 0 ? 1.12 : 0.89))));
  }, []);

  const dragging = useRef<{ x: number; y: number } | null>(null);

  return (
    <div style={{ font: "13px/1.5 system-ui, sans-serif", background: "#100d14", color: "#e9e4ee", minHeight: "100vh" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", padding: "10px 14px", borderBottom: "1px solid #2c2536" }}>
        <strong style={{ letterSpacing: 0.3 }}>Nirvana West — region design pilot</strong>
        <span style={{ display: "flex", gap: 6 }}>
          {NIRVANA_WEST_COMPOSITION_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={(): void => setComposition(id)}
              style={{
                padding: "5px 11px", borderRadius: 6, cursor: "pointer",
                border: id === composition ? "1px solid #ff6a3d" : "1px solid #392f47",
                background: id === composition ? "#3a1c14" : "#1c1626",
                color: "inherit", font: "inherit",
              }}
            >
              {LABELS[id]}
            </button>
          ))}
        </span>
        <span style={{ display: "flex", gap: 6 }}>
          {NIRVANA_WEST_RUIN_KITS.map((kit) => (
            <button
              key={kit}
              type="button"
              onClick={(): void => setRuinKit(kit)}
              style={{
                padding: "5px 11px", borderRadius: 6, cursor: "pointer",
                border: kit === ruinKit ? "1px solid #9ad0ff" : "1px solid #392f47",
                background: kit === ruinKit ? "#16283a" : "#1c1626",
                color: "inherit", font: "inherit",
              }}
            >
              {kit === "ancient" ? "ruins: ancient" : "ruins: industrial"}
            </button>
          ))}
        </span>
        <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <input type="checkbox" checked={showBlocked} onChange={(e): void => setShowBlocked(e.target.checked)} />
          blocked ground
        </label>
        <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <input type="checkbox" checked={showPlots} onChange={(e): void => setShowPlots(e.target.checked)} />
          128 shelter plots
        </label>
        <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <input type="checkbox" checked={animate} onChange={(e): void => setAnimate(e.target.checked)} />
          animate
        </label>
        <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <input type="checkbox" checked={reducedMotion} onChange={(e): void => setReducedMotion(e.target.checked)} />
          reduced motion
        </label>
        <span style={{ opacity: 0.85 }}>
          plots lost <strong style={{ color: plots.lost === 0 ? "#8fe08f" : "#ffb26a" }}>{plots.lost}</strong>/128
          {"  ·  "}identity in view <strong style={{ color: visibility.plotsWithIdentityInView === 128 ? "#8fe08f" : "#ffb26a" }}>{visibility.plotsWithIdentityInView}</strong>/128
          {"  ·  "}max dist {visibility.maxDistance}
        </span>
        <span style={{ opacity: 0.85 }}>
          causeways E-W/N-S <strong>{causewaysByAxis["east-west"] ?? 0}/{causewaysByAxis["north-south"] ?? 0}</strong>
          {"  ·  "}demoted tiles <strong style={{ color: scene.demotedTiles === 0 ? "#8fe08f" : "#ffb26a" }}>{scene.demotedTiles}</strong>
        </span>
        <span style={{ opacity: 0.85 }}>
          toroidal seam mismatches{" "}
          <strong style={{ color: seam.mismatches === 0 ? "#8fe08f" : "#ff6a5a" }}>
            {seam.mismatches}
          </strong>
          {" "}(N/S {seam.northSouth ? "ok" : "FAIL"} · E/W {seam.eastWest ? "ok" : "FAIL"})
        </span>
        <span style={{ opacity: 0.85 }}>
          animated env <strong>{animatedReport.total}</strong>
          {" "}(ember {animatedReport.ember} / vent {animatedReport["ember-vent"]} / smoke {animatedReport["smoke-anchor"]} / haze {animatedReport["heat-haze"]})
        </span>
        <span style={{ opacity: 0.55 }}>drag to pan · wheel to zoom · {(zoom * 100).toFixed(0)}%</span>
      </div>
      <div
        onWheel={onWheel}
        onPointerDown={(e): void => { dragging.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }; }}
        onPointerUp={(): void => { dragging.current = null; }}
        onPointerLeave={(): void => { dragging.current = null; }}
        onPointerMove={(e): void => {
          const origin = dragging.current;
          if (origin !== null) setPan({ x: e.clientX - origin.x, y: e.clientY - origin.y });
        }}
        style={{ overflow: "hidden", height: "calc(100vh - 46px)", cursor: "grab", background: "#0a0810" }}
      >
        <canvas
          ref={canvasRef}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            imageRendering: "pixelated",
            display: "block",
          }}
        />
      </div>
    </div>
  );
}
