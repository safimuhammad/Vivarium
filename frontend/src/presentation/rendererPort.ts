import {
  assertValidFrameIdentity,
  type CameraMode,
  type FrameIdentity,
  type ObserverSelection,
  type PresentedObserverFrame,
  type SafeFrameInsets,
  type Vec2,
} from "./contracts";
import type { RendererSemanticSnapshot } from "../renderer2d/production/semantics";

export type { PresentedObserverFrame } from "./contracts";

export interface ObserverRendererDiagnostics {
  readonly disposed: boolean;
  readonly frameIdentity: FrameIdentity | null;
  readonly drawP95Ms: number;
  readonly scheduledFrame: boolean;
  readonly activeActors: number;
  readonly activeHomes: number;
  readonly activeEffects: number;
  readonly staticLayerRebuilds: number;
  readonly assetBytes: number;
  readonly decodedAssetBytes: number;
  readonly pathFallbacks: number;
}

export interface ObserverRendererFailure {
  readonly kind: "canvas" | "asset" | "marker" | "path";
  readonly retryable: boolean;
  readonly publicMessage: string;
}

/**
 * What the world view is currently showing, published whenever it changes so the shell can render
 * the navigation affordances (hover readout, the explicit "back to world" control, the step-out
 * hint). Everything here is a CONSEQUENCE of viewer navigation — nothing in this contract moves the
 * camera.
 */
export interface WorldNavigationState {
  /** `"region"` = the viewer is inside a place; `"world"` = the archipelago. */
  readonly scope: "world" | "region";
  /** The region the viewer is inside (region scope) or centred over (world scope). */
  readonly regionId: string | null;
  /** Display name for {@link regionId}. */
  readonly regionName: string | null;
  /** The island under the pointer at world zoom, if any. */
  readonly hoveredRegionId: string | null;
  readonly hoveredRegionName: string | null;
  /** Live readout for the hovered island: beings alive, shelters standing. */
  readonly hoveredPopulation: number | null;
  readonly hoveredHomes: number | null;
  /**
   * True while the viewer is pressed against the region's zoom floor: the step-out is offered but
   * NOT taken (see `production/world/worldNavigation.ts`'s detent). This is the affordance that
   * makes leaving deliberate instead of accidental.
   */
  readonly exitOffered: boolean;
}

export interface ObserverRendererPort {
  updatePresentation(frame: PresentedObserverFrame): void;
  setSelection(selection: ObserverSelection): void;
  focusSelection(selection: Exclude<ObserverSelection, null>): void;
  observeRegion(regionId: string): void;
  setSafeFrame(insets: SafeFrameInsets): void;
  setCameraMode(mode: CameraMode): void;
  panCamera(deltaCss: Vec2): void;
  zoomCamera(factor: number, anchorCss: Vec2): void;
  resize(cssWidth: number, cssHeight: number): void;
  diagnostics(): ObserverRendererDiagnostics;
  dispose(): void;
  /**
   * Points the world view's hover at a canvas position, or clears it with `null`.
   *
   * Optional so every existing renderer double keeps satisfying this port. Renderers that do not
   * draw the world sheet have nothing to hover.
   */
  hoverAt?(anchorCss: Vec2 | null): void;
  /**
   * Descends into whichever region is at a canvas position — the click/double-click gesture. A
   * position over open sea, or a call while already inside a region, does nothing.
   *
   * This is a VIEWER action: it takes camera authority (the badge appears) rather than being
   * treated as automatic framing.
   */
  enterRegionAt?(anchorCss: Vec2): void;
  /** The explicit, deliberate way out of a region: Esc, the badge control, or the zoom-out detent. */
  exitToWorldView?(): void;
  /**
   * Selects whatever the renderer draws at a canvas position — the *completed click*.
   *
   * Selection is deliberately NOT driven by the renderer's own canvas press: the host owns the drag
   * dead zone and therefore owns the only place that can tell a click apart from a pan. A press that
   * becomes a pan must never select, so the host calls this on `pointerup` and only for a gesture
   * that stayed inside the dead zone. A call made while a descent is in the air is declined by the
   * renderer — one gesture does one thing.
   */
  selectAt?(anchorCss: Vec2): void;
}

export interface ObserverRendererCallbacks {
  onSelectionChange?(selection: ObserverSelection): void;
  onBeatActivate?(momentId: string): void;
  onCameraModeChange?(mode: CameraMode): void;
  /**
   * Fires when framing authority moves between the viewer and the automatic director.
   *
   * `true` means the viewer has taken the camera (a pan, a zoom, or choosing Follow/Free) and
   * NOTHING automatic will move it again until an explicit release. The shell is expected to
   * surface a release affordance while this holds -- silent auto-framing is the defect this
   * signal exists to make impossible to ship.
   */
  onCameraAuthorityChange?(viewerControlled: boolean): void;
  /** Fires whenever the world view's navigation state changes; see {@link WorldNavigationState}. */
  onWorldNavigationChange?(state: WorldNavigationState): void;
  onDiagnostics?(diagnostics: ObserverRendererDiagnostics): void;
  onFailure?(failure: ObserverRendererFailure): void;
  onSemanticSnapshot?(snapshot: RendererSemanticSnapshot): void;
}

/** Adds identity validation and idempotent lifecycle ownership to a renderer port. */
export function createGuardedObserverRendererPort(
  delegate: ObserverRendererPort,
): ObserverRendererPort {
  let disposed = false;
  let disposedDiagnostics: ObserverRendererDiagnostics | null = null;

  return {
    updatePresentation(frame): void {
      if (disposed) return;
      assertValidFrameIdentity(frame);
      delegate.updatePresentation(frame);
    },
    setSelection(selection): void {
      if (!disposed) delegate.setSelection(selection);
    },
    focusSelection(selection): void {
      if (!disposed) delegate.focusSelection(selection);
    },
    observeRegion(regionId): void {
      if (!disposed) delegate.observeRegion(regionId);
    },
    setSafeFrame(insets): void {
      if (!disposed) delegate.setSafeFrame(insets);
    },
    setCameraMode(mode): void {
      if (!disposed) delegate.setCameraMode(mode);
    },
    panCamera(deltaCss): void {
      if (!disposed) delegate.panCamera(deltaCss);
    },
    zoomCamera(factor, anchorCss): void {
      if (!disposed) delegate.zoomCamera(factor, anchorCss);
    },
    resize(cssWidth, cssHeight): void {
      if (!disposed) delegate.resize(cssWidth, cssHeight);
    },
    // World-view navigation, forwarded only when the delegate implements it: the guard must not
    // invent an interaction a renderer does not have.
    hoverAt(anchorCss): void {
      if (!disposed) delegate.hoverAt?.(anchorCss);
    },
    enterRegionAt(anchorCss): void {
      if (!disposed) delegate.enterRegionAt?.(anchorCss);
    },
    exitToWorldView(): void {
      if (!disposed) delegate.exitToWorldView?.();
    },
    selectAt(anchorCss): void {
      if (!disposed) delegate.selectAt?.(anchorCss);
    },
    diagnostics(): ObserverRendererDiagnostics {
      if (disposed && disposedDiagnostics !== null) {
        return disposedDiagnostics;
      }
      const diagnostics = delegate.diagnostics();
      return diagnostics;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      try {
        const diagnostics = delegate.diagnostics();
        disposedDiagnostics = diagnostics.disposed
          ? diagnostics
          : { ...diagnostics, disposed: true };
      } catch {
        disposedDiagnostics = disposedRendererDiagnostics();
      }
      delegate.dispose();
    },
  };
}

function disposedRendererDiagnostics(): ObserverRendererDiagnostics {
  return {
    disposed: true,
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
  };
}
