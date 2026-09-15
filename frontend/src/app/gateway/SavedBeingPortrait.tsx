/** A saved being's deterministic production sprite, with no renderer or model runtime. */
import { useEffect, useMemo, useRef } from "react";

import atlasUrl from "../../assets/renderer2d/core/being-chibi.png";
import {
  BEING_CHIBI_GEOMETRY,
  beingChibiFrameRect,
} from "../../renderer2d/production/actors/beingChibiAtlas";
import {
  createVisualPaletteVariantSource,
  drawBeingAccessory,
} from "../../renderer2d/production/actors/beingPalette";
import { resolveBeingVisualIdentity } from "../../renderer2d/production/actors/visualIdentity";

export interface SavedBeingPortraitProps {
  readonly id: string;
  /** Kept for saved-run catalogue compatibility; visual identity is id-only. */
  readonly persona?: string | null;
  /** Native-size rendering keeps dense observer cards compact without blurring the sprite grid. */
  readonly size?: "default" | "compact";
  /** Optional host class for contextual styling such as an unavailable card. */
  readonly className?: string;
}

interface PortraitSize {
  readonly outerWidth: number;
  readonly outerHeight: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly scale: number;
  readonly bottom: number;
  readonly anchor: "top" | "bottom";
  readonly clip: boolean;
}

const PORTRAIT_SIZES: Readonly<Record<"default" | "compact", PortraitSize>> = Object.freeze({
  default: Object.freeze({
    outerWidth: 44,
    outerHeight: 76,
    displayWidth: 33,
    displayHeight: 72,
    scale: 1.5,
    bottom: 2,
    anchor: "bottom",
    clip: false,
  }),
  compact: Object.freeze({
    // The card view is a small head-and-shoulders tile. It uses the same
    // standing frame and palette as the full portrait, but clips its feet
    // below the viewport instead of shrinking the whole character.
    outerWidth: 44,
    outerHeight: 44,
    displayWidth: 33,
    displayHeight: 72,
    scale: 1.5,
    bottom: 0,
    anchor: "top",
    clip: true,
  }),
});

/**
 * All portraits sample the same packed atlas. Keep its load promise at module
 * scope so each portrait shares one decoded image and the palette compositor's
 * bounded per-source cache; a failed request clears the promise for a later
 * retry. Consumers only cancel their own paint continuation on unmount.
 */
let atlasImagePromise: Promise<HTMLImageElement> | null = null;

function loadAtlasImage(): Promise<HTMLImageElement> {
  if (atlasImagePromise !== null) return atlasImagePromise;
  if (typeof Image === "undefined") return Promise.reject(new Error("Saved being atlas is unavailable."));

  const image = new Image();
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => {
      image.onload = null;
      image.onerror = null;
      resolve(image);
    };
    image.onerror = () => {
      image.onload = null;
      image.onerror = null;
      atlasImagePromise = null;
      reject(new Error("Saved being atlas could not be loaded."));
    };
  });
  atlasImagePromise = promise;
  image.src = atlasUrl;
  return promise;
}

/**
 * Paint the same native-size frame used by the live actor, then let CSS scale
 * that finished pixel grid. A background span remains as a graceful fallback
 * while the atlas image loads or when a canvas context is unavailable.
 */
export function SavedBeingPortrait({ id, size = "default", className }: SavedBeingPortraitProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const identity = useMemo(() => resolveBeingVisualIdentity(id), [id]);
  const frame = beingChibiFrameRect("walk-down-1", identity.characterId);
  const portraitSize = PORTRAIT_SIZES[size];

  useEffect(() => {
    let cancelled = false;
    void loadAtlasImage().then((image) => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (canvas === null || context === null || context === undefined) return;
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, BEING_CHIBI_GEOMETRY.frameWidth, BEING_CHIBI_GEOMETRY.frameHeight);
      let source: CanvasImageSource = image;
      try {
        source = createVisualPaletteVariantSource(image, identity.paletteVariant, identity.characterId);
      } catch {
        // The raw atlas remains a useful fallback in canvas-less test/SSR
        // environments; the live actor follows the same cosmetic policy.
      }
      context.drawImage(
        source,
        frame.x,
        frame.y,
        BEING_CHIBI_GEOMETRY.frameWidth,
        BEING_CHIBI_GEOMETRY.frameHeight,
        0,
        0,
        BEING_CHIBI_GEOMETRY.frameWidth,
        BEING_CHIBI_GEOMETRY.frameHeight,
      );
      drawBeingAccessory(context, identity.accessory, identity.paletteVariant, 0, 0);
    }).catch(() => {
      // The background span remains visible after an atlas load failure, and
      // the loader clears its promise so a later portrait can retry.
    });
    return () => {
      cancelled = true;
    };
  }, [frame.x, frame.y, identity.accessory, identity.characterId, identity.paletteVariant]);

  return (
    <span
      aria-hidden="true"
      className={className}
      data-being-portrait="true"
      data-character-id={identity.characterId}
      data-palette-variant={identity.paletteVariant}
      data-accessory={identity.accessory}
      style={{
        display: "grid",
        width: portraitSize.outerWidth,
        height: portraitSize.outerHeight,
        placeItems: "end center",
        position: "relative",
        flexShrink: 0,
        overflow: portraitSize.clip ? "hidden" : undefined,
      }}
    >
      <span
        style={{
          display: "block",
          width: BEING_CHIBI_GEOMETRY.frameWidth,
          height: BEING_CHIBI_GEOMETRY.frameHeight,
          position: "absolute",
          left: "50%",
          ...(portraitSize.anchor === "top"
            ? { top: 0 }
            : { bottom: portraitSize.bottom }),
          backgroundImage: `url(${atlasUrl})`,
          backgroundPosition: `${-frame.x}px ${-frame.y}px`,
          backgroundRepeat: "no-repeat",
          imageRendering: "pixelated",
          transform: `translateX(-50%) scale(${portraitSize.scale})`,
          transformOrigin: `${portraitSize.anchor} center`,
        }}
      />
      <canvas
        ref={canvasRef}
        width={BEING_CHIBI_GEOMETRY.frameWidth}
        height={BEING_CHIBI_GEOMETRY.frameHeight}
        style={{
          display: "block",
          width: portraitSize.displayWidth,
          height: portraitSize.displayHeight,
          position: "absolute",
          left: "50%",
          ...(portraitSize.anchor === "top"
            ? { top: 0 }
            : { bottom: portraitSize.bottom }),
          imageRendering: "pixelated",
          transform: "translateX(-50%)",
          pointerEvents: "none",
        }}
      />
    </span>
  );
}
