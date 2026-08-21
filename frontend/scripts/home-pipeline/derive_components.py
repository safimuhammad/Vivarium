"""Derive components.png frames for hut-kit from the aligned house-b states.

Pipeline (per H1 STEP 2): crop each architectural region from the aligned
reference states using ONE shared affine transform (so every 128x128 frame
lands in the same coordinate system and composites correctly), mode-pool
downscale, snap onto a shared derived palette, despeckle.
"""

from __future__ import annotations

import sys

sys.path.insert(
    0, "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/character-pipeline"
)

from PIL import Image, ImageDraw
from pxutil import mode_pool

WORK = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work"
OUT = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work/components"

SCALE = 0.30
OFFSET_X = 13
OFFSET_Y = 2
CELL = 128


def to_cell(x: int, y: int) -> tuple[int, int]:
    return round(x * SCALE + OFFSET_X), round(y * SCALE + OFFSET_Y)


def crop_aligned(state: str, rect: tuple[int, int, int, int]) -> Image.Image:
    img = Image.open(f"{WORK}/{state}-aligned.png").convert("RGBA")
    return img.crop(rect)


def punch(
    img: Image.Image, origin_xy: tuple[int, int], holes: list[tuple[int, int, int, int]]
) -> Image.Image:
    """Zero alpha for hole rects (in the SAME aligned coord space) relative to img's own origin."""
    out = img.copy()
    px = out.load()
    ox, oy = origin_xy
    w, h = out.size
    for hx0, hy0, hx1, hy1 in holes:
        x0, y0 = max(0, hx0 - ox), max(0, hy0 - oy)
        x1, y1 = min(w, hx1 - ox), min(h, hy1 - oy)
        for y in range(y0, y1):
            for x in range(x0, x1):
                r, g, b, _a = px[x, y]
                px[x, y] = (r, g, b, 0)
    return out


def place_on_cell(processed: Image.Image, aligned_rect: tuple[int, int, int, int]) -> Image.Image:
    """Paste a processed (already mode-pooled to final scale) crop onto a 128x128 cell.

    aligned_rect is the ORIGINAL (pre-scale) rect this crop came from; its
    top-left maps through the shared transform to locate it on the cell.
    """
    cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    tx, ty = to_cell(aligned_rect[0], aligned_rect[1])
    cell.alpha_composite(processed, (tx, ty))
    return cell


def process(crop: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """Mode-pool downscale a crop to an exact target size (independent x/y scale ok)."""
    # mode_pool only takes target_h and preserves aspect from src; do our own 2-pass:
    # first mode-pool to target_h keeping native aspect, then resize width with NEAREST
    # to hit the exact target_w (small horizontal squash/stretch, matches scale-derived box).
    pooled = mode_pool(crop, max(1, target_h))
    if pooled.width != target_w and pooled.width > 0:
        pooled = pooled.resize((max(1, target_w), max(1, target_h)), Image.Resampling.NEAREST)
    return pooled


# ---- Aligned-space region rects (x0, y0, x1, y1) ----
ROOF_S2 = (36, 65, 304, 235)
WALL_S2 = (36, 195, 304, 372)
DOOR_S2 = (72, 212, 226, 398)
WINDOW_S2 = (250, 233, 320, 300)
CHIMNEY_S2 = (234, 0, 306, 150)
FOUNDATION_S2 = (34, 358, 306, 405)
POST_S1 = (75, 130, 290, 372)

ROOF_S3 = (36, 10, 304, 195)
WALL_S3 = (36, 195, 304, 372)
DOOR_S3 = (60, 205, 232, 400)
WINDOW_S3 = (230, 234, 288, 284)

# fragments from state4 (aligned) for "falling" frames -- verified via dbg-state4-wide.png
ROOF_FALL_S4 = (85, 120, 230, 255)
WALL_FALL_S4 = (270, 235, 380, 365)
DOOR_FALL_S4 = (120, 250, 210, 365)


def build() -> None:
    import os

    os.makedirs(OUT, exist_ok=True)

    def cell_from(
        state: str, rect: tuple[int, int, int, int], holes: list | None = None
    ) -> Image.Image:
        crop = crop_aligned(state, rect)
        if holes:
            crop = punch(crop, (rect[0], rect[1]), holes)
        tw = max(1, round((rect[2] - rect[0]) * SCALE))
        th = max(1, round((rect[3] - rect[1]) * SCALE))
        processed = process(crop, tw, th)
        return place_on_cell(processed, rect)

    frames: dict[str, Image.Image] = {}

    frames["foundation"] = cell_from("state2-complete", FOUNDATION_S2)
    frames["post"] = cell_from("state1-construction", POST_S1)
    frames["wall-intact"] = cell_from(
        "state2-complete", WALL_S2, holes=[DOOR_S2, WINDOW_S2, FOUNDATION_S2]
    )
    frames["wall-cracked"] = cell_from(
        "state3-breached", WALL_S3, holes=[DOOR_S3, WINDOW_S3, FOUNDATION_S2]
    )
    frames["roof-intact"] = cell_from("state2-complete", ROOF_S2)
    frames["roof-damaged"] = cell_from("state3-breached", ROOF_S3)
    frames["door-closed"] = cell_from("state2-complete", DOOR_S2)
    frames["door-breached"] = cell_from("state3-breached", DOOR_S3)
    frames["window-cold"] = cell_from("state3-breached", WINDOW_S3)
    frames["window-lit"] = cell_from("state2-complete", WINDOW_S2)
    frames["chimney"] = cell_from("state2-complete", CHIMNEY_S2)
    frames["roof-falling"] = cell_from("state4-collapsed", ROOF_FALL_S4)
    frames["wall-falling"] = cell_from("state4-collapsed", WALL_FALL_S4)
    frames["door-falling"] = cell_from("state4-collapsed", DOOR_FALL_S4)

    for name, img in frames.items():
        img.save(f"{OUT}/{name}.png")

    # contact sheet
    names = list(frames.keys())
    cols = 5
    sheet = Image.new(
        "RGBA",
        (cols * (CELL + 8) + 8, ((len(names) - 1) // cols + 1) * (CELL + 24) + 8),
        (247, 239, 220, 255),
    )
    d = ImageDraw.Draw(sheet)
    for i, name in enumerate(names):
        cx, cy = (i % cols) * (CELL + 8) + 8, (i // cols) * (CELL + 24) + 8
        sheet.alpha_composite(frames[name], (cx, cy))
        d.text((cx, cy + CELL + 2), name, fill=(20, 20, 20, 255))
    sheet.save(f"{WORK}/preview/components-pass1.png")
    print("built", len(frames), "frames ->", f"{WORK}/preview/components-pass1.png")


if __name__ == "__main__":
    build()
