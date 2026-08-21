export interface Vec2 { readonly x: number; readonly y: number }
export interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface SafeFrameInsets { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number }
export type Direction4 = "north" | "east" | "south" | "west";
export type CameraMode = "story" | "follow" | "free";
export type EntitySelection =
  | { readonly kind: "agent"; readonly id: string }
  | { readonly kind: "home"; readonly id: string }
  | { readonly kind: "region"; readonly id: string }
  | null;

export interface DialogueState {
  readonly speakerId: string;
  readonly speakerName: string;
  readonly text: string;
  readonly visibleCharacters: number;
  readonly cursor: number;
  readonly hold: boolean;
}

export interface CanvasRendererDiagnostics {
  readonly disposed: boolean;
  readonly frameCount: number;
  readonly scheduledFrame: boolean;
  readonly cadence: "motion-60" | "ambient-30" | "idle";
  readonly lastDrawMs: number;
  readonly drawP95Ms: number;
  readonly drawDurationsMs: readonly number[];
  readonly staticLayerRebuilds: number;
  readonly actorCount: number;
  readonly shelterCount: number;
  readonly activeAnimations: number;
  readonly assetBytesLoaded: number;
  readonly decodedAssetBytes: number;
  readonly missingSprites: readonly string[];
  readonly pathFallbacks: number;
  readonly longFrames: number;
  readonly logicalViewport: Rect;
  readonly cssScale: number;
  readonly cropMode: "desktop-full" | "mobile-crop";
  readonly smoothingEnabled: false;
  readonly integerDrawRects: boolean;
  readonly runtimeCounters?: Readonly<{
    actorSnapshotReads: number;
    shelterSnapshotReads: number;
    diagnosticsCallbacks: number;
    p95Computations: number;
  }>;
}

export interface CanvasRendererPort {
  setSelection(selection: EntitySelection): void;
  focusSelection(selection: Exclude<EntitySelection, null>): void;
  setCameraMode(mode: CameraMode): void;
  panCamera(deltaCss: Vec2): void;
  zoomCamera(factor: number, anchorCss: Vec2): void;
  setSafeFrame(insets: SafeFrameInsets): void;
  resize(cssWidth: number, cssHeight: number): void;
  getDiagnostics(): CanvasRendererDiagnostics;
  dispose(): void;
}

export interface FrameDriver { request(callback: FrameRequestCallback): number; cancel(handle: number): void; now(): number }
export interface WakeScheduler { schedule(atMs: number, callback: () => void): number; cancel(handle: number): void; now(): number }
export interface CanvasRendererCallbacks {
  onSelect?(selection: EntitySelection): void;
  onDialogueChange?(dialogue: DialogueState | null): void;
  onCameraModeChange?(mode: CameraMode): void;
  onDiagnostics?(diagnostics: CanvasRendererDiagnostics): void;
  onAssetLoadFailure?(failure: Readonly<{
    missingSprites: readonly SpriteAtlasId[];
    message: string;
  }>): void;
}
export interface CanvasWorldRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly callbacks: CanvasRendererCallbacks;
  readonly signal?: AbortSignal;
  readonly frameDriver?: FrameDriver;
  readonly wakeScheduler?: WakeScheduler;
  readonly reducedMotion?: boolean;
  readonly initialScene?: "walk" | "dialogue" | "shelter-build" | "shelter-collapse" | "full-loop" | "static";
  /** Factory seam for isolated renderer tests; each renderer still owns the returned store. */
  readonly atlasStoreFactory?: () => SpriteAtlasStore;
}

export interface Vivarium2DSliceDebug {
  isReady(): boolean;
  pause(): void;
  resume(): void;
  restart(): void;
  seek(milliseconds: number): void;
  advanceBy(milliseconds: number): void;
  setScene(scene: DemoSceneName): void;
  actorState(id: string): ActorSnapshot | null;
  cameraState(): CameraSnapshot;
  shelterState(id: string): ShelterSnapshot2D | null;
  renderDiagnostics(): CanvasRendererDiagnostics;
  captureLogicalImageData(): ImageData;
}

export interface SliceCanvasRenderer extends CanvasRendererPort { debug(): Vivarium2DSliceDebug }

/**
 * Ambient compile-time forward declaration only; this module emits no runtime
 * factory. Task 7 provides the runtime function from its owning
 * CanvasWorldRenderer module. Task 1 consumers must use type-only imports.
 */
export declare function createCanvasWorldRenderer(options: CanvasWorldRendererOptions): Promise<SliceCanvasRenderer>;
import type { ActorSnapshot } from "./actors/HumanActor";
import type { SpriteAtlasId, SpriteAtlasStore } from "./assets/atlasStore";
import type { CameraSnapshot } from "./camera/Camera2D";
import type { DemoSceneName } from "./demoScene";
import type { ShelterSnapshot2D } from "./homes/ShelterActor";
