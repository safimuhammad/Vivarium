/** Passive scenery placed at existing authored roots and sorted among walking beings. */
import type { Rect, Vec2 } from "../../contracts";
import type { RegionMapRecipeV1 } from "../maps/RegionMapRecipe";
import { stableHash } from "../maps/directedTopology";
import { nirvanaInitialRegionSidecar } from "../nirvana/NirvanaRegionMapRecipe";
import { nirvanaEastAuthoredSceneSidecar } from "../nirvanaEast/NirvanaEastRegionMapRecipe";
import { nirvanaWestAuthoredSceneSidecar } from "../nirvanaWest/NirvanaWestRegionMapRecipe";
import { warmSpringsAuthoredSceneSidecar } from "../warmSprings/WarmSpringsRegionMapRecipe";
import { DEPTH_SCENERY_FRAMES, type DepthSceneryKind } from "./DepthSceneryAssets";

export interface DepthSceneryPlacement {
  readonly id: string;
  readonly kind: DepthSceneryKind;
  readonly feet: Vec2;
  readonly bounds: Rect;
}

interface Root { readonly id: string; readonly frameId: string; readonly feet: Vec2; }
const cache = new WeakMap<RegionMapRecipeV1, readonly DepthSceneryPlacement[]>();
const MAX_PROPS = 96;
export const DEPTH_SCENERY_FRAME_INTERVAL_MS = 125;
const motionCache = new WeakMap<DepthSceneryPlacement, Readonly<{ phase: number; periodMs: number }>>();

/** A slow, deterministic canopy lean. Stone, dead timber and retained map rasters stay still. */
export function depthScenerySway(prop: DepthSceneryPlacement, nowMs: number): number {
  if ((prop.kind !== "oak" && prop.kind !== "willow") || !Number.isFinite(nowMs)) return 0;
  let motion = motionCache.get(prop);
  if (motion === undefined) {
    const hash = stableHash(`canopy-v1:${prop.id}`);
    motion = { phase: (hash / 0xffffffff) * Math.PI * 2, periodMs: 4800 + hash % 1201 };
    motionCache.set(prop, motion);
  }
  const sampledMs = Math.floor(nowMs / DEPTH_SCENERY_FRAME_INTERVAL_MS) * DEPTH_SCENERY_FRAME_INTERVAL_MS;
  return Math.sin(sampledMs / motion.periodMs * Math.PI * 2 + motion.phase)
    * (prop.kind === "willow" ? 0.012 : 0.008);
}

/** Match generated details to the exact static painter operation they replace. */
export function depthSceneryReplacements(recipe: RegionMapRecipeV1): ReadonlyMap<string, DepthSceneryPlacement> {
  const prefix = recipe.regionId === "nirvana" ? "scenery:" : "prop:";
  return new Map(depthSceneryPlacements(recipe).map((prop) => [`${prefix}${prop.id}`, prop]));
}

/** Read only trusted authored placements, never generate collision or invent a walkable prop. */
function rootsFor(recipe: RegionMapRecipeV1): readonly Root[] {
  const nirvana = nirvanaInitialRegionSidecar(recipe);
  if (nirvana !== null) return [...nirvana.region.chunks.values()].flatMap((chunk) =>
    chunk.scenery.filter(({ blocksMovement }) => blocksMovement).map((sprite) => ({
      id: `${chunk.coord.column},${chunk.coord.row}:${sprite.id}`, frameId: sprite.frameId,
      feet: { x: chunk.coord.column * 48 * 32 + sprite.foot.x, y: chunk.coord.row * 32 * 32 + sprite.foot.y },
    })));
  const scene = nirvanaEastAuthoredSceneSidecar(recipe)?.scene
    ?? nirvanaWestAuthoredSceneSidecar(recipe)?.scene
    ?? warmSpringsAuthoredSceneSidecar(recipe)?.scene;
  return scene?.props.filter((prop) => prop.blocks).map((prop) => ({
    id: prop.id, frameId: prop.frameId, feet: { x: prop.footX, y: prop.footY },
  })) ?? [];
}

function kindFor(root: Root, region: string): DepthSceneryKind | null {
  if (region === "nirvana_east") return /^s\.(boulder|hoodoo)\./.test(root.frameId) ? "sandstone" : null;
  if (region === "nirvana_west") return /^s\.(snag|snagtall)\./.test(root.frameId) ? "cedar" : null;
  if (root.frameId.startsWith("s.boulder.") && stableHash(root.id) % 7 === 0) return "well";
  if (!/^s\.(willow|birch|broadleaf|conifer|oak|alder)\./.test(root.frameId)) return null;
  return region === "warm_springs" || root.frameId.startsWith("s.willow.") ? "willow" : "oak";
}

/** Resolve a stable, bounded subset of the authored scenery without changing map geometry. */
export function depthSceneryPlacements(recipe: RegionMapRecipeV1): readonly DepthSceneryPlacement[] {
  const prior = cache.get(recipe);
  if (prior !== undefined) return prior;
  const result: DepthSceneryPlacement[] = [];
  // Hash order distributes details across the whole region instead of filling its first rows.
  const roots = [...rootsFor(recipe)].sort((a, b) => stableHash(a.id) - stableHash(b.id) || a.id.localeCompare(b.id));
  for (const root of roots) {
    const kind = kindFor(root, recipe.regionId);
    if (kind === null) continue;
    if (result.some(({ feet }) => Math.hypot(feet.x - root.feet.x, feet.y - root.feet.y) < 126)) continue;
    const hash = stableHash(`depth-v1:${root.id}`);
    const height = kind === "well" ? 72 : kind === "sandstone" ? 49 + hash % 7 : (kind === "cedar" ? 150 : 178) + hash % 23;
    const frame = DEPTH_SCENERY_FRAMES[kind];
    const width = Math.round(height * frame.width / frame.height);
    result.push(Object.freeze({
      id: root.id, kind, feet: Object.freeze({ ...root.feet }),
      bounds: Object.freeze({ x: Math.round(root.feet.x - width / 2), y: root.feet.y + 5 - height, width, height }),
    }));
    if (result.length >= MAX_PROPS) break;
  }
  result.sort((a, b) => a.feet.y - b.feet.y || a.id.localeCompare(b.id));
  const frozen = Object.freeze(result);
  cache.set(recipe, frozen);
  return frozen;
}

/** Canopy transparency reveals a being behind a tree without changing either position. */
export function depthSceneryOpacity(prop: DepthSceneryPlacement, beings: readonly Vec2[]): number {
  if (prop.kind !== "oak" && prop.kind !== "willow" && prop.kind !== "cedar") return 1;
  return beings.some((feet) => feet.y < prop.feet.y && feet.y > prop.bounds.y + 28
    && Math.abs(feet.x - prop.feet.x) < prop.bounds.width * 0.4) ? 0.42 : 1;
}

/** Ground contact and a restrained directional shadow, kept below every walking being. */
export function drawDepthSceneryShadows(context: CanvasRenderingContext2D, props: readonly DepthSceneryPlacement[], view?: Rect): void {
  context.save();
  for (const prop of props) {
    if (!depthSceneryInView(prop, view)) continue;
    const tree = prop.kind === "oak" || prop.kind === "willow" || prop.kind === "cedar";
    context.fillStyle = tree ? "rgba(20,32,24,0.13)" : "rgba(45,27,24,0.16)";
    context.beginPath();
    context.ellipse(prop.feet.x + prop.bounds.width * 0.17, prop.feet.y + 3,
      prop.bounds.width * 0.37, tree ? 15 : 9, -0.16, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "rgba(12,22,19,0.22)";
    context.beginPath();
    context.ellipse(prop.feet.x, prop.feet.y + 2, tree ? 16 : 23, 5, 0, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

/** Draw a feet-anchored prop at its depth, fading the canopy while a being passes behind. */
export function drawDepthSceneryProp(
  context: CanvasRenderingContext2D, source: CanvasImageSource, prop: DepthSceneryPlacement,
  beings: readonly Vec2[], view?: Rect, motionNowMs?: number,
): void {
  if (!depthSceneryInView(prop, view)) return;
  const frame = DEPTH_SCENERY_FRAMES[prop.kind];
  const bounds = prop.bounds;
  context.save();
  context.globalAlpha *= depthSceneryOpacity(prop, beings);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const sway = motionNowMs === undefined ? 0 : depthScenerySway(prop, motionNowMs);
  if (sway !== 0) {
    context.translate(prop.feet.x, prop.feet.y);
    context.rotate(sway);
    context.translate(-prop.feet.x, -prop.feet.y);
  }
  context.drawImage(source, frame.x, frame.y, frame.width, frame.height,
    bounds.x, bounds.y, bounds.width, bounds.height);
  context.restore();
}

/** Cull off-screen decoration, including its small ground shadow, before issuing any blits. */
export function depthSceneryInView(prop: DepthSceneryPlacement, view?: Rect): boolean {
  if (view === undefined) return true;
  const b = prop.bounds;
  return b.x - 20 < view.x + view.width && b.x + b.width + 20 > view.x
    && b.y < view.y + view.height && b.y + b.height + 20 > view.y;
}
