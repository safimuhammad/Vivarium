export type CacheCanvasLabel = "terrain" | "scenery" | "continuation-matte";

export interface CacheCanvasOwner {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  dispose(): void;
}

export interface CacheCanvasOwnerInput {
  readonly label: CacheCanvasLabel;
  readonly width: number;
  readonly height: number;
  readonly createCanvas: () => HTMLCanvasElement;
  readonly release?: (canvas: HTMLCanvasElement) => void;
}

export type CacheCanvasOwnerFactoryInput = Readonly<Pick<
  CacheCanvasOwnerInput,
  "label" | "width" | "height"
>>;

export type CacheCanvasOwnerFactory = (
  input: CacheCanvasOwnerFactoryInput,
) => CacheCanvasOwner;

/** Own one offscreen static-layer canvas and release its backing store exactly once. */
export function createCacheCanvasOwner(input: CacheCanvasOwnerInput): CacheCanvasOwner {
  if (!Number.isSafeInteger(input.width) || input.width <= 0
    || !Number.isSafeInteger(input.height) || input.height <= 0) {
    throw new RangeError("Cache canvas dimensions must be positive safe integers.");
  }
  const canvas = input.createCanvas();
  canvas.dataset.cache = input.label;
  canvas.width = input.width;
  canvas.height = input.height;
  const context = canvas.getContext("2d");
  if (context === null) {
    canvas.width = 0;
    canvas.height = 0;
    input.release?.(canvas);
    throw new Error(`Canvas2D ${input.label} cache context is unavailable.`);
  }
  context.imageSmoothingEnabled = false;
  let disposed = false;
  return {
    canvas,
    context,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const width = canvas.width;
      const height = canvas.height;
      context.clearRect(0, 0, width, height);
      canvas.width = 0;
      canvas.height = 0;
      input.release?.(canvas);
    },
  };
}
