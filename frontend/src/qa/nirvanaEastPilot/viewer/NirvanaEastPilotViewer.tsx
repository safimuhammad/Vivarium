/**
 * Viewable pilot page for the three Nirvana East compositions.
 *
 * Sibling of `warmSpringsPilot/viewer/WarmSpringsPilotViewer.tsx`: a viewer
 * for choosing a design by eye, not a product. It paints the real pilot
 * scene through the real pilot painter (`createEastPaintPlan` /
 * `renderEastPlan`, which in turn run on the PRODUCTION static-scene
 * primitives), so what is on screen is the same pixels the offline plates
 * write rather than a second rendering path that could disagree with them.
 *
 * Controls: composition switch (A/B/C), a walkability overlay toggle, a
 * shelter-plot overlay toggle, drag-to-pan with wheel zoom, a live readout of
 * plot cost / identity-in-view / the torus report, and one thing Warm
 * Springs' viewer does not have: a WRAP toggle that renders the scene 3x3
 * tiled (contract §2 — the region is a torus) so the owner can pan across a
 * seam in the live page and see the wrap continue.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import {
  createEastPaintPlan,
  renderEastPlan,
  type CompactEastAtlasManifest,
} from "../eastPainter";
import {
  NIRVANA_EAST_COMPOSITION_IDS,
  createNirvanaEastScene,
  type NirvanaEastCompositionId,
  type NirvanaEastScene,
} from "../eastScene";
import { identityVisibilityReport, shelterPlotReport, torusReport } from "../eastWalkability";
import manifest from "../assets/atlas.json";
import terrainUrl from "../assets/terrain.png";
import sceneryUrl from "../assets/scenery.png";

const LABELS: Readonly<Record<NirvanaEastCompositionId, string>> = {
  "a-arroyo-braid": "A — Dry Wash Country",
  "b-mesa-field": "B — Butte Country",
  "c-salt-pan": "C — The Striped Pan",
};

/** How many tiles per side the wrap toggle repeats the scene into (a 3x3 block, centred). */
const WRAP_REPEAT = 3;

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = (): void => resolve(image);
    image.onerror = (): void => reject(new Error(`Could not load ${source}`));
    image.src = source;
  });
}

export function NirvanaEastPilotViewer(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [composition, setComposition] = useState<NirvanaEastCompositionId>("a-arroyo-braid");
  const [showBlocked, setShowBlocked] = useState(false);
  const [showPlots, setShowPlots] = useState(false);
  const [wrapMode, setWrapMode] = useState(false);
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

  const scene: NirvanaEastScene = useMemo(
    () => createNirvanaEastScene(composition),
    [composition],
  );
  const plots = useMemo(() => shelterPlotReport(scene), [scene]);
  const visibility = useMemo(() => identityVisibilityReport(scene), [scene]);
  const torus = useMemo(() => torusReport(scene), [scene]);

  // Dropping the zoom automatically when wrap mode turns on keeps the (much
  // larger) 3x3 canvas inside a sane viewport without the owner having to
  // hunt for the right scroll wheel amount first.
  useEffect(() => {
    setZoom((current) => (wrapMode ? Math.min(current, 0.11) : current));
  }, [wrapMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || sources === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;

    const repeat = wrapMode ? WRAP_REPEAT : 1;
    canvas.width = scene.widthPixels * repeat;
    canvas.height = scene.heightPixels * repeat;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);

    const plan = createEastPaintPlan(scene, manifest as unknown as CompactEastAtlasManifest);
    for (let tileRow = 0; tileRow < repeat; tileRow += 1) {
      for (let tileColumn = 0; tileColumn < repeat; tileColumn += 1) {
        renderEastPlan(context, plan, sources, {
          x: -tileColumn * scene.widthPixels,
          y: -tileRow * scene.heightPixels,
        });
      }
    }

    if (showBlocked) {
      context.fillStyle = "rgba(226, 62, 54, 0.42)";
      for (let tileRow = 0; tileRow < repeat; tileRow += 1) {
        for (let tileColumn = 0; tileColumn < repeat; tileColumn += 1) {
          const offsetX = tileColumn * scene.widthPixels;
          const offsetY = tileRow * scene.heightPixels;
          for (let row = 0; row < scene.rows; row += 1) {
            for (let column = 0; column < scene.columns; column += 1) {
              if (scene.collision[row * scene.columns + column] !== 1) continue;
              context.fillRect(
                offsetX + column * scene.tileSize,
                offsetY + row * scene.tileSize,
                scene.tileSize,
                scene.tileSize,
              );
            }
          }
        }
      }
    }
    if (showPlots) {
      for (let tileRow = 0; tileRow < repeat; tileRow += 1) {
        for (let tileColumn = 0; tileColumn < repeat; tileColumn += 1) {
          const offsetX = tileColumn * scene.widthPixels;
          const offsetY = tileRow * scene.heightPixels;
          for (const status of plots.statuses) {
            // The real 128x128 shelter render rect starts at the plot tile's CENTRE.
            const x = offsetX + status.plot.tile.column * scene.tileSize + scene.tileSize / 2;
            const y = offsetY + status.plot.tile.row * scene.tileSize + scene.tileSize / 2;
            context.strokeStyle = status.clear ? "#68e880" : "#ff483c";
            context.lineWidth = status.clear ? 2 : 5;
            context.strokeRect(x, y, 128, 128);
          }
        }
      }
    }
    if (wrapMode) {
      // Seam guides at every internal tile boundary of the 3x3 block, so a
      // panning owner can find the join without hunting for it.
      context.strokeStyle = "rgba(90, 240, 255, 0.55)";
      context.lineWidth = 3;
      for (let tileIndex = 1; tileIndex < repeat; tileIndex += 1) {
        context.beginPath();
        context.moveTo(tileIndex * scene.widthPixels, 0);
        context.lineTo(tileIndex * scene.widthPixels, canvas.height);
        context.stroke();
        context.beginPath();
        context.moveTo(0, tileIndex * scene.heightPixels);
        context.lineTo(canvas.width, tileIndex * scene.heightPixels);
        context.stroke();
      }
    }
  }, [scene, sources, showBlocked, showPlots, plots, wrapMode]);

  const onWheel = useCallback((event: React.WheelEvent<HTMLDivElement>): void => {
    setZoom((current) => Math.min(2, Math.max(0.03, current * (event.deltaY < 0 ? 1.12 : 0.89))));
  }, []);

  const dragging = useRef<{ x: number; y: number } | null>(null);

  return (
    <div style={{ font: "13px/1.5 system-ui, sans-serif", background: "#12160f", color: "#e6ebe2", minHeight: "100vh" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", padding: "10px 14px", borderBottom: "1px solid #2a3124" }}>
        <strong style={{ letterSpacing: 0.3 }}>Nirvana East — region design pilot</strong>
        <span style={{ display: "flex", gap: 6 }}>
          {NIRVANA_EAST_COMPOSITION_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={(): void => setComposition(id)}
              style={{
                padding: "5px 11px", borderRadius: 6, cursor: "pointer",
                border: id === composition ? "1px solid #c14a2c" : "1px solid #39412f",
                background: id === composition ? "#3a1c14" : "#1b2016",
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
        <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <input type="checkbox" checked={wrapMode} onChange={(e): void => setWrapMode(e.target.checked)} />
          wrap (3x3 tiled — pan across a seam)
        </label>
        <span style={{ opacity: 0.85 }}>
          plots lost <strong style={{ color: plots.lost === 0 ? "#8fe08f" : "#ffb26a" }}>{plots.lost}</strong>/128
          {"  ·  "}identity in view <strong style={{ color: visibility.plotsWithIdentityInView === 128 ? "#8fe08f" : "#ffb26a" }}>{visibility.plotsWithIdentityInView}</strong>/128
          {"  ·  "}max dist {visibility.maxDistance}
          {"  ·  "}crossings {scene.crossings.length}
        </span>
        <span style={{ opacity: 0.85 }}>
          torus seam mismatch NS/EW{" "}
          <strong style={{ color: torus.seamMismatchNS === 0 && torus.seamMismatchEW === 0 ? "#8fe08f" : "#ff6a5a" }}>
            {torus.seamMismatchNS}/{torus.seamMismatchEW}
          </strong>
          {"  ·  "}wrap openings NS/EW{" "}
          <strong style={{ color: torus.wrapOpeningsNS > 0 && torus.wrapOpeningsEW > 0 ? "#8fe08f" : "#ffb26a" }}>
            {torus.wrapOpeningsNS}/{torus.wrapOpeningsEW}
          </strong>
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
