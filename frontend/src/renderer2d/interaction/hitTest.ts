import type { EntitySelection, Rect, Vec2 } from "../contracts";
import type { Camera2DPort } from "../camera/Camera2D";

const MIN_HIT_TARGET_CSS_PIXELS = 44;

export interface HitTarget {
  readonly selection: Exclude<EntitySelection, null>;
  readonly worldBounds: Rect;
  readonly feetY?: number;
  readonly selectionKey?: string;
}

export interface HitTestOptions {
  readonly pointCss: Vec2;
  readonly targets: readonly HitTarget[];
  readonly camera: Pick<Camera2DPort, "worldToScreen">;
  readonly cssScale?: number;
  readonly canvasOffsetCss?: Vec2;
  readonly minimumTargetCssPixels?: number;
}

interface ProjectedTarget {
  readonly target: HitTarget;
  readonly hitBounds: Rect;
  readonly feetY: number;
  readonly key: string;
  readonly canonicalKey: string;
}

function finiteVec2(value: Vec2): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y);
}

function finiteRect(rect: Rect): boolean {
  return Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && Number.isFinite(rect.x + rect.width)
    && Number.isFinite(rect.y + rect.height);
}

function canonicalSelectionKey(target: HitTarget): string {
  return `${target.selection.id}:${target.selection.kind}`;
}

function projectTarget(
  target: HitTarget,
  camera: Pick<Camera2DPort, "worldToScreen">,
  cssScale: number,
  offset: Vec2,
  minimumSize: number,
): ProjectedTarget | null {
  if (!finiteRect(target.worldBounds)) return null;
  const first = camera.worldToScreen({ x: target.worldBounds.x, y: target.worldBounds.y });
  const second = camera.worldToScreen({
    x: target.worldBounds.x + target.worldBounds.width,
    y: target.worldBounds.y + target.worldBounds.height,
  });
  if (!finiteVec2(first) || !finiteVec2(second)) return null;
  const left = Math.min(first.x, second.x) * cssScale + offset.x;
  const top = Math.min(first.y, second.y) * cssScale + offset.y;
  const width = Math.abs(second.x - first.x) * cssScale;
  const height = Math.abs(second.y - first.y) * cssScale;
  const hitWidth = Math.max(minimumSize, width);
  const hitHeight = Math.max(minimumSize, height);
  const hitBounds = {
    x: left + (width - hitWidth) / 2,
    y: top + (height - hitHeight) / 2,
    width: hitWidth,
    height: hitHeight,
  };
  if (!finiteRect(hitBounds)) return null;
  const boundsFeetY = target.worldBounds.y + target.worldBounds.height;

  return {
    target,
    feetY: Number.isFinite(target.feetY) ? target.feetY! : boundsFeetY,
    key: target.selectionKey ?? canonicalSelectionKey(target),
    canonicalKey: canonicalSelectionKey(target),
    hitBounds,
  };
}

function contains(rect: Rect, point: Vec2): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/** Returns the visually foremost selectable entity below one CSS-space point. */
export function hitTest(options: HitTestOptions): EntitySelection {
  if (!finiteVec2(options.pointCss)) return null;
  const cssScale = Number.isFinite(options.cssScale) && (options.cssScale ?? 0) > 0
    ? options.cssScale!
    : 1;
  const minimumSize = Number.isFinite(options.minimumTargetCssPixels)
    ? Math.max(MIN_HIT_TARGET_CSS_PIXELS, options.minimumTargetCssPixels ?? MIN_HIT_TARGET_CSS_PIXELS)
    : MIN_HIT_TARGET_CSS_PIXELS;
  const offset = options.canvasOffsetCss !== undefined && finiteVec2(options.canvasOffsetCss)
    ? options.canvasOffsetCss
    : { x: 0, y: 0 };

  const matches = options.targets
    .map((target) => projectTarget(target, options.camera, cssScale, offset, minimumSize))
    .filter((target): target is ProjectedTarget => target !== null)
    .filter(({ hitBounds }) => contains(hitBounds, options.pointCss));
  matches.sort((a, b) => b.feetY - a.feetY
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    || (a.canonicalKey < b.canonicalKey ? -1 : a.canonicalKey > b.canonicalKey ? 1 : 0));
  return matches[0]?.target.selection ?? null;
}
