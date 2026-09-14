/** A display-resolution surface for legibility chrome above the pixel-art world. */
export interface OverlayCanvasTarget {
  readonly context: CanvasRenderingContext2D;
  readonly pixelRatio: number;
}

/** Resize and clear an owned overlay without changing the world's CSS-pixel camera. */
export function prepareOverlayCanvas(
  canvas: HTMLCanvasElement | undefined,
  width: number,
  height: number,
): OverlayCanvasTarget | undefined {
  if (canvas === undefined) return undefined;
  const context = canvas.getContext("2d");
  if (context === null) return undefined;
  const deviceRatio = canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1;
  const pixelRatio = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  const rasterWidth = Math.max(1, Math.ceil(width * pixelRatio));
  const rasterHeight = Math.max(1, Math.ceil(height * pixelRatio));
  if (canvas.width !== rasterWidth) canvas.width = rasterWidth;
  if (canvas.height !== rasterHeight) canvas.height = rasterHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, rasterWidth, rasterHeight);
  return { context, pixelRatio };
}
