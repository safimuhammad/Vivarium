import type { Direction4, Vec2 } from "../contracts";

export interface FrameRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface SpriteFrame { readonly rect: FrameRect; readonly durationMs: number; readonly feet: Vec2; readonly heldAnchor?: Vec2; readonly faceFrame?: string }
export interface AnimationMarker { readonly frame: number; readonly name: "contact" | "commit" | "cancel" | "particle" }
export interface SpriteClip {
  readonly id: string;
  readonly direction: Direction4 | "none";
  readonly frames: readonly SpriteFrame[];
  readonly loop: boolean;
  readonly strideLength?: number;
  readonly markers: readonly AnimationMarker[];
  readonly cancelFrames: readonly number[];
}
export interface SpriteLayerManifest {
  readonly id: "body" | "face" | "held";
  readonly atlasId: "human-body" | "human-face" | "human-held";
  readonly clips: Readonly<Record<string, SpriteClip>>;
  readonly anchor: Vec2;
  readonly tintable: boolean;
}
export interface SpriteManifest {
  readonly id: string;
  readonly logicalWidth: 48;
  readonly logicalHeight: 64;
  readonly layers: readonly SpriteLayerManifest[];
  readonly faceAnchor: Vec2;
  readonly heldAnchor: Vec2;
}

const ATLAS_BOUNDS = {
  "human-body": { width: 672, height: 512 },
  "human-face": { width: 384, height: 256 },
  "human-held": { width: 384, height: 64 },
} as const;

const insideCell = ({ x, y }: Vec2, width: number, height: number): boolean =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < width && y >= 0 && y < height;

const isPositiveFiniteInteger = (value: number): boolean =>
  Number.isFinite(value) && Number.isInteger(value) && value > 0;

export function validateSpriteManifest(manifest: SpriteManifest): readonly string[] {
  const errors: string[] = [];
  if (manifest.logicalWidth !== 48 || manifest.logicalHeight !== 64) errors.push("logical sprite must be native 48x64");
  if (!insideCell(manifest.faceAnchor, 48, 64)) errors.push("face anchor outside logical cell");
  if (!insideCell(manifest.heldAnchor, 48, 64)) errors.push("held anchor outside logical cell");
  const expectedAtlases = { body: "human-body", face: "human-face", held: "human-held" } as const;
  for (const id of ["body", "face", "held"] as const) {
    const matches = manifest.layers.filter((layer) => layer.id === id);
    if (matches.length !== 1) errors.push(`manifest requires exactly one ${id} layer`);
    for (const layer of matches) if (layer.atlasId !== expectedAtlases[id]) errors.push(`${id}: expected ${expectedAtlases[id]} atlas`);
  }
  if (manifest.layers.length !== 3) errors.push("manifest requires exactly three layers");
  for (const layer of manifest.layers) {
    const bounds = ATLAS_BOUNDS[layer.atlasId];
    if (!bounds) { errors.push(`${layer.id}: unknown atlas`); continue; }
    if (!insideCell(layer.anchor, 48, 64)) errors.push(`${layer.id}: layer anchor outside logical cell`);
    for (const [key, clip] of Object.entries(layer.clips)) {
      if (clip.frames.length === 0) errors.push(`${layer.id}/${key}: empty clip`);
      if (clip.id.startsWith("walk_") && !isPositiveFiniteInteger(clip.strideLength ?? Number.NaN)) errors.push(`${layer.id}/${key}: walk clip requires finite integer stride`);
      if (clip.strideLength !== undefined && !isPositiveFiniteInteger(clip.strideLength)) errors.push(`${layer.id}/${key}: stride must be a positive finite integer`);
      clip.frames.forEach((frame, index) => {
        const { rect } = frame;
        if (rect.width !== 48 || rect.height !== 64) errors.push(`${layer.id}/${key}/${index}: non-native frame size`);
        if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || ![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger)) errors.push(`${layer.id}/${key}/${index}: frame rect must use finite integers`);
        if (rect.x % 48 !== 0 || rect.y % 64 !== 0) errors.push(`${layer.id}/${key}/${index}: frame rect must align to native cells`);
        if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > bounds.width || rect.y + rect.height > bounds.height) errors.push(`${layer.id}/${key}/${index}: frame outside atlas`);
        if (!isPositiveFiniteInteger(frame.durationMs)) errors.push(`${layer.id}/${key}/${index}: duration must be a positive finite integer`);
        if (!insideCell(frame.feet, 48, 64)) errors.push(`${layer.id}/${key}/${index}: feet outside cell`);
        if (frame.heldAnchor && !insideCell(frame.heldAnchor, 48, 64)) errors.push(`${layer.id}/${key}/${index}: held anchor outside cell`);
      });
      for (const marker of clip.markers) if (!Number.isInteger(marker.frame) || marker.frame < 0 || marker.frame >= clip.frames.length) errors.push(`${layer.id}/${key}: marker outside clip`);
      for (const frame of clip.cancelFrames) if (!Number.isInteger(frame) || frame < 0 || frame >= clip.frames.length) errors.push(`${layer.id}/${key}: cancel frame outside clip`);
    }
  }
  return errors;
}
