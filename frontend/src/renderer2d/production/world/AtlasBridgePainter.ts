/**
 * @fileoverview Material-backed, display-only inter-island bridges for the atlas view.
 *
 * `BridgeSpan` remains the semantic authority for connectivity. This module only turns its two
 * coast anchors into a small 2.5D crossing: a lifted deck, vertical supports, fascia, rails, and
 * tapered landings. The material source is a fixed 2x2 atlas, so every texture crop is explicit
 * and repeatable rather than being a whole-bridge stretched image.
 */

import type { BridgeSpan } from "./islandBridges";

const DEFAULT_TEXTURE_SIZE = 1024;
const MAX_DECK_SEGMENTS = 64;
const MAX_RAIL_POSTS = 32;
const MAX_SUPPORTS = 32;

const LIGHT_FROM_ABOVE_LEFT = Object.freeze({ x: -0.7071067811865476, y: -0.7071067811865476 });

/** A source rectangle within the supplied 2x2 bridge material atlas. */
export interface AtlasBridgeTextureRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Source quadrants for the exact 1024 px material atlas generated for atlas bridges. */
export const ATLAS_BRIDGE_TEXTURE_QUADRANTS = Object.freeze({
  deckTimber: Object.freeze({ x: 0, y: 0, width: 512, height: 512 }),
  deckStone: Object.freeze({ x: 512, y: 0, width: 512, height: 512 }),
  supportTimber: Object.freeze({ x: 0, y: 512, width: 512, height: 512 }),
  supportMasonry: Object.freeze({ x: 512, y: 512, width: 512, height: 512 }),
} satisfies Readonly<Record<string, AtlasBridgeTextureRect>>);

/** A point in atlas world/sheet coordinates. */
export interface AtlasBridgePoint {
  readonly x: number;
  readonly y: number;
}

/** Conservative screen-space bounds for the entire display-only bridge. */
export interface AtlasBridgeBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Deterministic dimensions and bounded detail counts for one span. */
export interface AtlasBridgeGeometry {
  readonly length: number;
  readonly direction: AtlasBridgePoint;
  readonly normal: AtlasBridgePoint;
  readonly width: number;
  readonly maxRise: number;
  readonly fasciaDepth: number;
  readonly railHeight: number;
  readonly supportHeight: number;
  readonly segmentCount: number;
  readonly postCount: number;
  readonly supportCount: number;
  readonly bounds: AtlasBridgeBounds;
}

/** Optional display-only controls. Both fields multiply the caller's existing canvas state. */
export interface AtlasBridgePainterOptions {
  /** Additional bridge opacity, multiplied by the caller's current `globalAlpha`. Defaults to `1`. */
  readonly opacity?: number;
  /** Source atlas side length. The shipped bridge atlas is 1024 px. */
  readonly textureSize?: number;
  /** Optional atlas day/night colour pass, restricted to bridge material surfaces. */
  readonly tint?: string;
  /** Opacity of `tint`, multiplied by the caller's current `globalAlpha`. */
  readonly tintAlpha?: number;
}

interface BridgeStyle {
  readonly deck: string;
  readonly deckShade: string;
  readonly fascia: string;
  readonly rail: string;
  readonly railLight: string;
  readonly support: string;
  readonly supportLight: string;
  readonly landing: string;
  readonly landingEdge: string;
}

interface MaterialQuadrants {
  readonly deck: AtlasBridgeTextureRect;
  readonly support: AtlasBridgeTextureRect;
}

interface PointBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Clamp an arbitrary value into a closed, finite range. */
function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function finitePoint(point: AtlasBridgePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function spanMetrics(span: BridgeSpan): Readonly<{
  dx: number;
  dy: number;
  length: number;
  direction: AtlasBridgePoint;
  normal: AtlasBridgePoint;
}> {
  const dx = span.b.x - span.a.x;
  const dy = span.b.y - span.a.y;
  const measuredLength = Math.hypot(dx, dy);
  if (!Number.isFinite(measuredLength) || measuredLength < 0.0001) {
    return {
      dx: 0,
      dy: 0,
      length: 0,
      direction: Object.freeze({ x: 1, y: 0 }),
      normal: Object.freeze({ x: 0, y: 1 }),
    };
  }
  const direction = Object.freeze({ x: dx / measuredLength, y: dy / measuredLength });
  return {
    dx,
    dy,
    length: measuredLength,
    direction,
    normal: Object.freeze({ x: -direction.y, y: direction.x }),
  };
}

function riseFor(span: BridgeSpan, length: number): number {
  const intended = span.kind === "causeway" ? 16 : 14;
  return Math.min(intended, Math.max(0, length * 0.18));
}

function styleFor(span: BridgeSpan): BridgeStyle {
  return span.kind === "causeway"
    ? {
      deck: "#aaa59c",
      deckShade: "#858077",
      fascia: "#625f5a",
      rail: "#514e49",
      railLight: "#dedbd3",
      support: "#6c6962",
      supportLight: "#b7b2a8",
      landing: "#908b80",
      landingEdge: "#d2cdc0",
    }
    : {
      deck: "#93683f",
      deckShade: "#60432b",
      fascia: "#4c3424",
      rail: "#3d291d",
      railLight: "#d9b77d",
      support: "#4a3021",
      supportLight: "#8c6542",
      landing: "#765138",
      landingEdge: "#bf9360",
    };
}

function supportCountFor(span: BridgeSpan, length: number, width: number): number {
  const threshold = width * 1.35;
  if (length < threshold) return 0;
  const spacing = span.kind === "causeway" ? 190 : 152;
  return Math.min(MAX_SUPPORTS, Math.max(1, Math.floor(length / spacing)));
}

function supportHeightFor(span: BridgeSpan, length: number): number {
  const base = span.kind === "causeway" ? 42 : 30;
  const maximum = span.kind === "causeway" ? 68 : 54;
  return Math.min(maximum, base + Math.sqrt(Math.max(0, length)) * 0.42);
}

function landingLengthFor(width: number): number {
  return clamp(width * 0.27, 14, 30);
}

function frontNormalSign(normal: AtlasBridgePoint): number {
  if (Math.abs(normal.y) > 0.001) return normal.y > 0 ? 1 : -1;
  return normal.x > 0 ? 1 : -1;
}

function sidePoint(point: AtlasBridgePoint, normal: AtlasBridgePoint, distance: number): AtlasBridgePoint {
  return { x: point.x + normal.x * distance, y: point.y + normal.y * distance };
}

function pointAt(span: BridgeSpan, t: number): AtlasBridgePoint {
  const metrics = spanMetrics(span);
  const ratio = clamp(t, 0, 1);
  return {
    x: span.a.x + metrics.dx * ratio,
    y: span.a.y + metrics.dy * ratio,
  };
}

/**
 * Resolve a point on the slightly elevated visual deck. Endpoint values remain the exact coast
 * anchors, while the sine lift creates a smooth zero-slope rise and fall in screen Y.
 */
export function bridgeDeckPoint(span: BridgeSpan, t: number): AtlasBridgePoint {
  const metrics = spanMetrics(span);
  const ratio = clamp(t, 0, 1);
  const base = pointAt(span, ratio);
  if (metrics.length === 0) return base;
  return {
    x: base.x,
    y: base.y - Math.sin(Math.PI * ratio) * riseFor(span, metrics.length),
  };
}

/**
 * Resolve bounded visual geometry without drawing or mutating the semantic bridge span.
 */
export function atlasBridgeGeometry(span: BridgeSpan): AtlasBridgeGeometry {
  const metrics = spanMetrics(span);
  const width = span.kind === "causeway" ? 100 : 80;
  const maxRise = riseFor(span, metrics.length);
  const fasciaDepth = span.kind === "causeway" ? 18 : 14;
  const railHeight = span.kind === "causeway" ? 24 : 20;
  const supportHeight = supportHeightFor(span, metrics.length);
  const segmentLength = span.kind === "causeway" ? 48 : 38;
  const segmentCount = Math.min(MAX_DECK_SEGMENTS, Math.max(1, Math.ceil(metrics.length / segmentLength)));
  const postSpacing = span.kind === "causeway" ? 72 : 60;
  const postCount = Math.min(MAX_RAIL_POSTS, Math.max(2, Math.ceil(metrics.length / postSpacing) + 1));
  const supportCount = supportCountFor(span, metrics.length, width);
  const landingLength = landingLengthFor(width);
  const sideExtent = width / 2 + 5;
  const xExtent = Math.abs(metrics.normal.x) * sideExtent + Math.abs(metrics.direction.x) * landingLength;
  const yExtent = Math.abs(metrics.normal.y) * sideExtent + Math.abs(metrics.direction.y) * landingLength;
  const minX = Math.floor(Math.min(span.a.x, span.b.x) - xExtent - width * 0.16);
  const maxX = Math.ceil(Math.max(span.a.x, span.b.x) + xExtent + width * 0.16);
  const minY = Math.floor(Math.min(span.a.y, span.b.y) - maxRise - yExtent - railHeight - 5);
  const maxY = Math.ceil(Math.max(span.a.y, span.b.y) + yExtent + supportHeight + fasciaDepth + 8);
  return Object.freeze({
    length: metrics.length,
    direction: metrics.direction,
    normal: metrics.normal,
    width,
    maxRise,
    fasciaDepth,
    railHeight,
    supportHeight,
    segmentCount,
    postCount,
    supportCount,
    bounds: Object.freeze({
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    }),
  });
}

function materialQuadrants(span: BridgeSpan, textureSize: number): MaterialQuadrants {
  const side = Math.max(2, Math.floor(textureSize));
  const half = side / 2;
  const topY = 0;
  const bottomY = half;
  const deckX = span.kind === "causeway" ? half : 0;
  const supportX = deckX;
  return {
    deck: { x: deckX, y: topY, width: half, height: half },
    support: { x: supportX, y: bottomY, width: half, height: half },
  };
}

function sourceSlice(
  quadrant: AtlasBridgeTextureRect,
  index: number,
  targetWidth: number,
  targetHeight: number,
): AtlasBridgeTextureRect {
  const ratio = targetWidth / Math.max(1, targetHeight);
  const width = clamp(Math.round(quadrant.height * ratio), 72, quadrant.width);
  const available = Math.max(0, quadrant.width - width);
  const offset = available === 0 ? 0 : (index * 97 + index * index * 13) % (available + 1);
  return {
    x: quadrant.x + offset,
    y: quadrant.y,
    width,
    height: quadrant.height,
  };
}

function tracePolygon(context: CanvasRenderingContext2D, points: readonly AtlasBridgePoint[]): void {
  if (points.length === 0) return;
  const first = points[0]!;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    context.lineTo(point.x, point.y);
  }
  context.closePath();
}

function boundsFor(points: readonly AtlasBridgePoint[]): PointBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function drawFilledPolygon(context: CanvasRenderingContext2D, points: readonly AtlasBridgePoint[], fill: string): void {
  tracePolygon(context, points);
  context.fillStyle = fill;
  context.fill();
}

function drawTexturedPolygon(
  context: CanvasRenderingContext2D,
  material: CanvasImageSource | null,
  source: AtlasBridgeTextureRect,
  points: readonly AtlasBridgePoint[],
  fallback: string,
): void {
  if (material === null) {
    drawFilledPolygon(context, points, fallback);
    return;
  }
  const bounds = boundsFor(points);
  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) return;
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  context.save();
  try {
    tracePolygon(context, points);
    context.clip();
    context.drawImage(
      material,
      source.x,
      source.y,
      source.width,
      source.height,
      bounds.minX,
      bounds.minY,
      width,
      height,
    );
  } finally {
    context.restore();
  }
}

function drawTexturedDeckSegment(
  context: CanvasRenderingContext2D,
  material: CanvasImageSource | null,
  source: AtlasBridgeTextureRect,
  start: AtlasBridgePoint,
  end: AtlasBridgePoint,
  halfWidth: number,
  fallback: string,
): void {
  const polygon = deckSegmentPolygon(start, end, halfWidth);
  if (polygon === null) return;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 0.0001) return;
  if (material === null) {
    drawFilledPolygon(context, polygon, fallback);
    return;
  }
  context.save();
  try {
    context.translate(start.x, start.y);
    context.rotate(Math.atan2(dy, dx));
    context.beginPath();
    context.moveTo(0, -halfWidth);
    context.lineTo(length, -halfWidth);
    context.lineTo(length, halfWidth);
    context.lineTo(0, halfWidth);
    context.closePath();
    context.clip();
    context.drawImage(
      material,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      -halfWidth,
      length,
      halfWidth * 2,
    );
  } finally {
    context.restore();
  }
}

function deckSegmentPolygon(
  start: AtlasBridgePoint,
  end: AtlasBridgePoint,
  halfWidth: number,
): readonly AtlasBridgePoint[] | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 0.0001) return null;
  const normal = { x: -dy / length, y: dx / length };
  return [
    sidePoint(start, normal, halfWidth),
    sidePoint(end, normal, halfWidth),
    sidePoint(end, normal, -halfWidth),
    sidePoint(start, normal, -halfWidth),
  ];
}

function drawVerticalTexturedFace(
  context: CanvasRenderingContext2D,
  material: CanvasImageSource | null,
  source: AtlasBridgeTextureRect,
  topStart: AtlasBridgePoint,
  topEnd: AtlasBridgePoint,
  depth: number,
  fallback: string,
): void {
  const dx = topEnd.x - topStart.x;
  const dy = topEnd.y - topStart.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.0001) return;
  const bottomStart = { x: topStart.x, y: topStart.y + depth };
  const bottomEnd = { x: topEnd.x, y: topEnd.y + depth };
  const polygon = [topStart, topEnd, bottomEnd, bottomStart];
  if (material === null) {
    drawFilledPolygon(context, polygon, fallback);
    return;
  }
  context.save();
  try {
    context.translate(topStart.x, topStart.y);
    context.transform(dx / length, dy / length, 0, 1, 0, 0);
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(length, 0);
    context.lineTo(length, depth);
    context.lineTo(0, depth);
    context.closePath();
    context.clip();
    context.drawImage(
      material,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      length,
      depth,
    );
  } finally {
    context.restore();
  }
}

function drawWaterShadow(
  context: CanvasRenderingContext2D,
  span: BridgeSpan,
  geometry: AtlasBridgeGeometry,
): void {
  const steps = Math.min(16, Math.max(3, Math.ceil(geometry.segmentCount / 4) + 1));
  const halfWidth = geometry.width / 2 + 9;
  const offset = { x: 5, y: 9 };
  const left: AtlasBridgePoint[] = [];
  const right: AtlasBridgePoint[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const point = bridgeDeckPoint(span, index / steps);
    left.push({
      x: point.x + geometry.normal.x * halfWidth + offset.x,
      y: point.y + geometry.normal.y * halfWidth + offset.y,
    });
    right.push({
      x: point.x - geometry.normal.x * halfWidth + offset.x,
      y: point.y - geometry.normal.y * halfWidth + offset.y,
    });
  }
  drawFilledPolygon(context, [...left, ...right.reverse()], "#082833");
}

function drawLanding(
  context: CanvasRenderingContext2D,
  span: BridgeSpan,
  geometry: AtlasBridgeGeometry,
  atStart: boolean,
  style: BridgeStyle,
): void {
  const endpoint = atStart ? bridgeDeckPoint(span, 0) : bridgeDeckPoint(span, 1);
  const outward = atStart ? -1 : 1;
  const length = landingLengthFor(geometry.width);
  const inner = {
    x: endpoint.x - geometry.direction.x * outward * 7,
    y: endpoint.y - geometry.direction.y * outward * 7,
  };
  const shore = {
    x: endpoint.x + geometry.direction.x * outward * length,
    y: endpoint.y + geometry.direction.y * outward * length,
  };
  const half = geometry.width / 2;
  const polygon = [
    sidePoint(shore, geometry.normal, half * 0.82),
    sidePoint(inner, geometry.normal, half),
    sidePoint(inner, geometry.normal, -half),
    sidePoint(shore, geometry.normal, -half * 0.82),
  ];
  drawFilledPolygon(context, polygon, style.landing);
  context.strokeStyle = style.landingEdge;
  context.lineWidth = 2.2;
  context.beginPath();
  context.moveTo(polygon[0]!.x, polygon[0]!.y);
  context.lineTo(polygon[1]!.x, polygon[1]!.y);
  context.lineTo(polygon[2]!.x, polygon[2]!.y);
  context.lineTo(polygon[3]!.x, polygon[3]!.y);
  context.stroke();
}

function supportTs(count: number): readonly number[] {
  if (count === 0) return [];
  return Array.from({ length: count }, (_unused, index) => (index + 1) / (count + 1));
}

function drawTimberTrestles(
  context: CanvasRenderingContext2D,
  span: BridgeSpan,
  geometry: AtlasBridgeGeometry,
  material: CanvasImageSource | null,
  supportTexture: AtlasBridgeTextureRect,
  style: BridgeStyle,
): void {
  const stationTs = supportTs(geometry.supportCount);
  const halfRun = geometry.width * 0.28;
  const postWidth = Math.max(5, geometry.width * 0.095);
  for (let index = 0; index < stationTs.length; index += 1) {
    const deck = bridgeDeckPoint(span, stationTs[index]!);
    const left = sidePoint(deck, geometry.normal, halfRun);
    const right = sidePoint(deck, geometry.normal, -halfRun);
    for (const top of [left, right]) {
      const post = [
        { x: top.x - postWidth / 2, y: top.y + 2 },
        { x: top.x + postWidth / 2, y: top.y + 2 },
        { x: top.x + postWidth / 2, y: top.y + geometry.supportHeight },
        { x: top.x - postWidth / 2, y: top.y + geometry.supportHeight },
      ];
      drawTexturedPolygon(
        context,
        material,
        sourceSlice(supportTexture, index, postWidth, geometry.supportHeight),
        post,
        style.support,
      );
    }
    context.strokeStyle = style.supportLight;
    context.lineWidth = 2.6;
    context.beginPath();
    context.moveTo(left.x, left.y + 4);
    context.lineTo(right.x, right.y + geometry.supportHeight - 2);
    context.moveTo(right.x, right.y + 4);
    context.lineTo(left.x, left.y + geometry.supportHeight - 2);
    context.stroke();
    context.strokeStyle = style.rail;
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(left.x, left.y + geometry.supportHeight);
    context.lineTo(right.x, right.y + geometry.supportHeight);
    context.stroke();
  }
}

function drawStoneArcade(
  context: CanvasRenderingContext2D,
  span: BridgeSpan,
  geometry: AtlasBridgeGeometry,
  material: CanvasImageSource | null,
  supportTexture: AtlasBridgeTextureRect,
  style: BridgeStyle,
): void {
  const stationTs = supportTs(geometry.supportCount);
  const piers: AtlasBridgePoint[] = [];
  const topWidth = geometry.width * 0.18;
  const footWidth = geometry.width * 0.27;
  for (let index = 0; index < stationTs.length; index += 1) {
    const top = bridgeDeckPoint(span, stationTs[index]!);
    piers.push(top);
    const polygon = [
      { x: top.x - topWidth, y: top.y + geometry.fasciaDepth * 0.35 },
      { x: top.x + topWidth, y: top.y + geometry.fasciaDepth * 0.35 },
      { x: top.x + footWidth, y: top.y + geometry.supportHeight },
      { x: top.x - footWidth, y: top.y + geometry.supportHeight },
    ];
    drawTexturedPolygon(
      context,
      material,
      sourceSlice(supportTexture, index, footWidth * 2, geometry.supportHeight),
      polygon,
      style.support,
    );
    context.strokeStyle = style.supportLight;
    context.lineWidth = 1.7;
    context.beginPath();
    context.moveTo(polygon[0]!.x, polygon[0]!.y);
    context.lineTo(polygon[3]!.x, polygon[3]!.y);
    context.stroke();
  }

  const anchors = [bridgeDeckPoint(span, 0), ...piers, bridgeDeckPoint(span, 1)];
  for (let index = 0; index + 1 < anchors.length; index += 1) {
    const left = anchors[index]!;
    const right = anchors[index + 1]!;
    const baseY = Math.max(left.y, right.y) + geometry.supportHeight * 0.82;
    const crownY = Math.max(left.y, right.y) + geometry.fasciaDepth + 5;
    const middleX = (left.x + right.x) / 2;
    // Piers are separate material silhouettes, leaving this opening untouched. That retains the
    // already-painted ocean, wave ticks, and live day/night sea palette below the causeway.
    context.strokeStyle = style.rail;
    context.lineWidth = 3.4;
    context.beginPath();
    context.moveTo(left.x, baseY);
    context.quadraticCurveTo(middleX, crownY, right.x, baseY);
    context.stroke();
    context.strokeStyle = style.supportLight;
    context.lineWidth = 2.1;
    context.beginPath();
    context.moveTo(left.x, baseY);
    context.quadraticCurveTo(middleX, crownY, right.x, baseY);
    context.stroke();
  }
}

function drawFascia(
  context: CanvasRenderingContext2D,
  span: BridgeSpan,
  geometry: AtlasBridgeGeometry,
  material: CanvasImageSource | null,
  supportTexture: AtlasBridgeTextureRect,
  style: BridgeStyle,
): void {
  const frontSign = frontNormalSign(geometry.normal);
  const half = geometry.width / 2;
  for (let index = 0; index < geometry.segmentCount; index += 1) {
    const start = bridgeDeckPoint(span, index / geometry.segmentCount);
    const end = bridgeDeckPoint(span, (index + 1) / geometry.segmentCount);
    const frontStart = sidePoint(start, geometry.normal, half * frontSign);
    const frontEnd = sidePoint(end, geometry.normal, half * frontSign);
    const length = Math.hypot(frontEnd.x - frontStart.x, frontEnd.y - frontStart.y);
    drawVerticalTexturedFace(
      context,
      material,
      sourceSlice(supportTexture, index, length, geometry.fasciaDepth),
      frontStart,
      frontEnd,
      geometry.fasciaDepth,
      style.fascia,
    );
  }
}

function drawDeckHighlight(
  context: CanvasRenderingContext2D,
  span: BridgeSpan,
  geometry: AtlasBridgeGeometry,
  style: BridgeStyle,
): void {
  const lightSide = geometry.normal.x * LIGHT_FROM_ABOVE_LEFT.x + geometry.normal.y * LIGHT_FROM_ABOVE_LEFT.y >= 0 ? 1 : -1;
  const half = geometry.width / 2 - 3;
  const steps = Math.min(24, Math.max(3, geometry.segmentCount));
  context.strokeStyle = style.railLight;
  context.lineWidth = 1.7;
  context.beginPath();
  for (let index = 0; index <= steps; index += 1) {
    const point = sidePoint(bridgeDeckPoint(span, index / steps), geometry.normal, half * lightSide);
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.stroke();
}

function drawRails(
  context: CanvasRenderingContext2D,
  span: BridgeSpan,
  geometry: AtlasBridgeGeometry,
  style: BridgeStyle,
): void {
  const half = geometry.width / 2 - 5;
  const steps = Math.min(24, Math.max(3, geometry.segmentCount));
  for (const side of [1, -1]) {
    context.strokeStyle = style.rail;
    context.lineWidth = span.kind === "causeway" ? 4.4 : 3.6;
    context.beginPath();
    for (let index = 0; index <= steps; index += 1) {
      const edge = sidePoint(bridgeDeckPoint(span, index / steps), geometry.normal, half * side);
      const top = { x: edge.x, y: edge.y - geometry.railHeight };
      if (index === 0) context.moveTo(top.x, top.y);
      else context.lineTo(top.x, top.y);
    }
    context.stroke();

    context.strokeStyle = style.railLight;
    context.lineWidth = 1.15;
    context.beginPath();
    for (let index = 0; index <= steps; index += 1) {
      const edge = sidePoint(bridgeDeckPoint(span, index / steps), geometry.normal, half * side);
      const top = { x: edge.x, y: edge.y - geometry.railHeight + 1.5 };
      if (index === 0) context.moveTo(top.x, top.y);
      else context.lineTo(top.x, top.y);
    }
    context.stroke();

    for (let index = 0; index < geometry.postCount; index += 1) {
      const ratio = index / (geometry.postCount - 1);
      const edge = sidePoint(bridgeDeckPoint(span, ratio), geometry.normal, half * side);
      context.strokeStyle = style.rail;
      context.lineWidth = span.kind === "causeway" ? 3.7 : 3;
      context.beginPath();
      context.moveTo(edge.x, edge.y + 2);
      context.lineTo(edge.x, edge.y - geometry.railHeight - 2);
      context.stroke();
    }
  }
}

function drawTintedTimberSupports(
  context: CanvasRenderingContext2D,
  span: BridgeSpan,
  geometry: AtlasBridgeGeometry,
  tint: string,
): void {
  const halfRun = geometry.width * 0.28;
  const postWidth = Math.max(5, geometry.width * 0.095);
  for (const ratio of supportTs(geometry.supportCount)) {
    const deck = bridgeDeckPoint(span, ratio);
    for (const top of [
      sidePoint(deck, geometry.normal, halfRun),
      sidePoint(deck, geometry.normal, -halfRun),
    ]) {
      drawFilledPolygon(context, [
        { x: top.x - postWidth / 2, y: top.y + 2 },
        { x: top.x + postWidth / 2, y: top.y + 2 },
        { x: top.x + postWidth / 2, y: top.y + geometry.supportHeight },
        { x: top.x - postWidth / 2, y: top.y + geometry.supportHeight },
      ], tint);
    }
  }
}

function drawTintedStonePiers(
  context: CanvasRenderingContext2D,
  span: BridgeSpan,
  geometry: AtlasBridgeGeometry,
  tint: string,
): void {
  const topWidth = geometry.width * 0.18;
  const footWidth = geometry.width * 0.27;
  for (const ratio of supportTs(geometry.supportCount)) {
    const top = bridgeDeckPoint(span, ratio);
    drawFilledPolygon(context, [
      { x: top.x - topWidth, y: top.y + geometry.fasciaDepth * 0.35 },
      { x: top.x + topWidth, y: top.y + geometry.fasciaDepth * 0.35 },
      { x: top.x + footWidth, y: top.y + geometry.supportHeight },
      { x: top.x - footWidth, y: top.y + geometry.supportHeight },
    ], tint);
  }
}

/** Apply the atlas-wide land light only inside the bridge's already-authored material shapes. */
function drawMaterialTint(
  context: CanvasRenderingContext2D,
  span: BridgeSpan,
  geometry: AtlasBridgeGeometry,
  tint: string,
): void {
  const half = geometry.width / 2;
  for (let index = 0; index < geometry.segmentCount; index += 1) {
    const start = bridgeDeckPoint(span, index / geometry.segmentCount);
    const end = bridgeDeckPoint(span, (index + 1) / geometry.segmentCount);
    const deck = deckSegmentPolygon(start, end, half);
    if (deck !== null) drawFilledPolygon(context, deck, tint);
  }

  const frontSign = frontNormalSign(geometry.normal);
  for (let index = 0; index < geometry.segmentCount; index += 1) {
    const start = bridgeDeckPoint(span, index / geometry.segmentCount);
    const end = bridgeDeckPoint(span, (index + 1) / geometry.segmentCount);
    const topStart = sidePoint(start, geometry.normal, half * frontSign);
    const topEnd = sidePoint(end, geometry.normal, half * frontSign);
    drawFilledPolygon(context, [
      topStart,
      topEnd,
      { x: topEnd.x, y: topEnd.y + geometry.fasciaDepth },
      { x: topStart.x, y: topStart.y + geometry.fasciaDepth },
    ], tint);
  }
  if (span.kind === "causeway") drawTintedStonePiers(context, span, geometry, tint);
  else drawTintedTimberSupports(context, span, geometry, tint);
}

/**
 * Draw a 2.5D cosmetic bridge over an existing semantic atlas span.
 *
 * The function has no interaction with adjacency, routes, or simulation state. It saves and
 * restores the canvas state; all internal transparency is multiplied by the caller's current
 * `globalAlpha`, so zoom/fade layers retain control of opacity.
 */
export function drawAtlasBridge(
  context: CanvasRenderingContext2D,
  span: BridgeSpan,
  material: CanvasImageSource | null,
  options: AtlasBridgePainterOptions = {},
): void {
  if (!finitePoint(span.a) || !finitePoint(span.b)) return;
  const geometry = atlasBridgeGeometry(span);
  if (geometry.length < 0.0001) return;
  const opacity = clamp(options.opacity ?? 1, 0, 1);
  if (opacity <= 0) return;
  const tint = typeof options.tint === "string" && options.tint.length > 0 ? options.tint : null;
  const tintAlpha = clamp(options.tintAlpha ?? 0, 0, 1);
  const textureSize = Number.isFinite(options.textureSize) ? options.textureSize! : DEFAULT_TEXTURE_SIZE;
  const quadrants = materialQuadrants(span, textureSize);
  const style = styleFor(span);
  const inheritedAlpha = clamp(context.globalAlpha, 0, 1);
  const setAlpha = (factor: number): void => {
    context.globalAlpha = inheritedAlpha * opacity * clamp(factor, 0, 1);
  };

  context.save();
  try {
    setAlpha(0.2);
    drawWaterShadow(context, span, geometry);

    setAlpha(0.92);
    if (span.kind === "causeway") {
      drawStoneArcade(context, span, geometry, material, quadrants.support, style);
    } else {
      drawTimberTrestles(context, span, geometry, material, quadrants.support, style);
    }

    setAlpha(1);
    drawLanding(context, span, geometry, true, style);
    drawLanding(context, span, geometry, false, style);
    const half = geometry.width / 2;
    for (let index = 0; index < geometry.segmentCount; index += 1) {
      const start = bridgeDeckPoint(span, index / geometry.segmentCount);
      const end = bridgeDeckPoint(span, (index + 1) / geometry.segmentCount);
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      drawTexturedDeckSegment(
        context,
        material,
        sourceSlice(quadrants.deck, index, length, geometry.width),
        start,
        end,
        half,
        style.deck,
      );
    }
    drawFascia(context, span, geometry, material, quadrants.support, style);

    if (material !== null && tint !== null && tintAlpha > 0) {
      setAlpha(tintAlpha);
      drawMaterialTint(context, span, geometry, tint);
    }

    setAlpha(0.85);
    drawDeckHighlight(context, span, geometry, style);
    setAlpha(1);
    drawRails(context, span, geometry, style);
  } finally {
    context.restore();
  }
}
