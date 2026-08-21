/**
 * Viewable pilot page for the three Warm Springs compositions.
 *
 * Deliberately small: it is a viewer for choosing a design by eye, not a
 * product. It paints the real pilot scene through the real pilot painter (the
 * same `createSpringsPaintPlan` / `renderSpringsPlan` the offline plates use,
 * which in turn run on the PRODUCTION static-scene primitives), so what is on
 * screen is the same pixels as the reference plates rather than a second
 * rendering path that could disagree with them.
 *
 * Controls: composition switch (A/B/C), a walkability overlay toggle, a
 * shelter-plot overlay toggle, and drag-to-pan with wheel zoom.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import {
  createSpringsPaintPlan,
  renderSpringsPlan,
  type CompactSpringsAtlasManifest,
} from "../springsPainter";
import {
  WARM_SPRINGS_COMPOSITION_IDS,
  createWarmSpringsScene,
  type WarmSpringsCompositionId,
  type WarmSpringsScene,
} from "../springsScene";
import { shelterPlotReport, springVisibilityReport } from "../springsWalkability";
import manifest from "../assets/atlas.json";
import terrainUrl from "../assets/terrain.png";
import sceneryUrl from "../assets/scenery.png";

const LABELS: Readonly<Record<WarmSpringsCompositionId, string>> = {
  "a-sinter-rim": "A — Sinter Rim",
  "b-great-terrace": "B — Great Terrace",
  "c-rift": "C — The Rift",
};

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = (): void => resolve(image);
    image.onerror = (): void => reject(new Error(`Could not load ${source}`));
    image.src = source;
  });
}

export function WarmSpringsPilotViewer(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [composition, setComposition] = useState<WarmSpringsCompositionId>("c-rift");
  const [showBlocked, setShowBlocked] = useState(false);
  const [showPlots, setShowPlots] = useState(false);
  const [zoom, setZoom] = useState(0.28);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [sources, setSources] = useState<
    { terrain: HTMLImageElement; scenery: HTMLImageElement } | null
  >(null);

  useEffect(() => {
    let live = true;
    void Promise.all([loadImage(terrainUrl), loadImage(sceneryUrl)]).then(
      ([terrain, scenery]) => {
        if (live) setSources({ terrain, scenery });
      },
    );
    return (): void => { live = false; };
  }, []);

  const scene: WarmSpringsScene = useMemo(
    () => createWarmSpringsScene(composition),
    [composition],
  );
  const plots = useMemo(() => shelterPlotReport(scene), [scene]);
  const visibility = useMemo(() => springVisibilityReport(scene), [scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || sources === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;

    canvas.width = scene.widthPixels;
    canvas.height = scene.heightPixels;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    renderSpringsPlan(context, createSpringsPaintPlan(scene, manifest as unknown as CompactSpringsAtlasManifest), sources);

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
  }, [scene, sources, showBlocked, showPlots, plots]);

  const onWheel = useCallback((event: React.WheelEvent<HTMLDivElement>): void => {
    setZoom((current) => Math.min(2, Math.max(0.08, current * (event.deltaY < 0 ? 1.12 : 0.89))));
  }, []);

  const dragging = useRef<{ x: number; y: number } | null>(null);

  return (
    <div style={{ font: "13px/1.5 system-ui, sans-serif", background: "#12160f", color: "#e6ebe2", minHeight: "100vh" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", padding: "10px 14px", borderBottom: "1px solid #2a3124" }}>
        <strong style={{ letterSpacing: 0.3 }}>Warm Springs — region design pilot</strong>
        <span style={{ display: "flex", gap: 6 }}>
          {WARM_SPRINGS_COMPOSITION_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={(): void => setComposition(id)}
              style={{
                padding: "5px 11px", borderRadius: 6, cursor: "pointer",
                border: id === composition ? "1px solid #d17f27" : "1px solid #39412f",
                background: id === composition ? "#3a2a14" : "#1b2016",
                color: "inherit", font: "inherit",
              }}
            >
              {LABELS[id]}
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
        <span style={{ opacity: 0.85 }}>
          plots lost <strong style={{ color: plots.lost === 0 ? "#8fe08f" : "#ffb26a" }}>{plots.lost}</strong>/128
          {"  ·  "}springs in view <strong style={{ color: visibility.plotsWithSpringInView === 128 ? "#8fe08f" : "#ffb26a" }}>{visibility.plotsWithSpringInView}</strong>/128
          {"  ·  "}max dist {visibility.maxDistance}
          {"  ·  "}boardwalks {scene.boardwalks.length}
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
        style={{ overflow: "hidden", height: "calc(100vh - 46px)", cursor: "grab", background: "#0b0f0c" }}
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
