"""Recolor the `door-open` component frame: dark recess instead of flat void.

## Root cause

`derive_components_full.py`'s `build_extra()` (the H1-era script whose
`door-open` derivation every later generation reused unchanged --
`derive_components_whole.py`/`derive_components_sprite.py` both list
`door-open` in `REUSED_SLOTS`/keep it a "small, genuinely additive overlay")
paints the door leaf with one flat fill:

    frames["door-open"] = <door-closed leaf region tinted (14, 12, 10, 255)>

That is a single near-black RGB with zero gradient or detail -- not a
transparency/asset-resolution bug (the alpha mask is fully opaque and
correctly shaped; `home-cleanup-report.md` item 3 confirms this by direct
pixel inspection: two flat opaque colors, (16,13,12,255) and (24,18,14,255)
after the shared palette-snap/despeckle pass, zero variation inside each).
It reads as a solid black cavity at native/6x viewing scale because there is
no depth cue at all -- exactly the owner's report.

## Fix

Recolor ONLY the existing opaque pixels of the `door-open` cell (alpha mask
byte-for-byte unchanged, so the shape/coverage relative to the door aperture
baked into `wall-intact` etc. is unchanged) with:
  - a vertical top-to-bottom gradient from a cool dark recess brown to a
    warmer, slightly lighter brown suggesting a floor plane catching ambient
    light, and
  - a soft, low-intensity warm amber glow blob near the bottom-center of the
    void, suggesting hearth-light spilling from within (kept subtle -- this
    is a suggestion of interior depth, not a literal lit scene; the kit has
    no separate "door-open-lit" state to key a stronger effect off of).

Applies to the one shared `components.png` door-open cell (index 13, 6
columns, 128px cells -> cell rect x=128,y=256,128x128) and writes the
identical recolored bytes to all 5 production kit copies plus the roster
draft copy, preserving the existing "one shared, palette-swap-identical
door-open frame across all region kits" convention (verified pixel-identical
across all 5 kits and the roster copy before this script ran).

Usage:
    python3 recolor_door_open.py --preview   # writes a zoomed before/after
                                              # comparison only, no writes
    python3 recolor_door_open.py --apply     # writes the recolored cell to
                                              # all 6 components.png copies
"""

from __future__ import annotations

import sys

from PIL import Image

CELL = 128
COLUMNS = 6
DOOR_OPEN_INDEX = 13  # HOME_COMPONENT_IDS[13] == "door-open"

ROSTER_PATH = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/assets/character-claude/roster/hut-kit/components.png"
PRODUCTION_PATHS = [
    "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/src/assets/renderer2d/homes/hut/components.png",
    "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/src/assets/renderer2d/homes/hut-spring-terraces/components.png",
    "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/src/assets/renderer2d/homes/hut-dry-scrub/components.png",
    "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/src/assets/renderer2d/homes/hut-ash-waste/components.png",
    "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/src/assets/renderer2d/homes/hut-neutral-temperate/components.png",
]
ALL_PATHS = [ROSTER_PATH, *PRODUCTION_PATHS]

PREVIEW_OUT = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work/preview/door-open-recolor.png"

TOP_COLOR = (22, 17, 15)
BOTTOM_COLOR = (56, 38, 25)
GLOW_COLOR = (255, 150, 64)
GLOW_CENTER = (44, 112)
GLOW_RADIUS = 15.0
GLOW_MAX_WEIGHT = 0.5


def cell_rect(index: int) -> tuple[int, int, int, int]:
    col = index % COLUMNS
    row = index // COLUMNS
    return col * CELL, row * CELL, (col + 1) * CELL, (row + 1) * CELL


def recolored_cell(cell: Image.Image) -> Image.Image:
    out = cell.copy()
    px = out.load()
    w, h = out.size
    opaque_ys = [y for y in range(h) for x in range(w) if px[x, y][3] > 0]
    miny, maxy = min(opaque_ys), max(opaque_ys)
    span = max(1, maxy - miny)
    gx, gy = GLOW_CENTER
    for y in range(h):
        t = (y - miny) / span
        t = min(1.0, max(0.0, t))
        base_r = round(TOP_COLOR[0] + (BOTTOM_COLOR[0] - TOP_COLOR[0]) * t)
        base_g = round(TOP_COLOR[1] + (BOTTOM_COLOR[1] - TOP_COLOR[1]) * t)
        base_b = round(TOP_COLOR[2] + (BOTTOM_COLOR[2] - TOP_COLOR[2]) * t)
        for x in range(w):
            _r, _g, _b, a = px[x, y]
            if a == 0:
                continue
            dist = ((x - gx) ** 2 + (y - gy) ** 2) ** 0.5
            glow = max(0.0, 1.0 - dist / GLOW_RADIUS)
            glow = glow * glow * GLOW_MAX_WEIGHT
            fr = round(base_r + (GLOW_COLOR[0] - base_r) * glow)
            fg = round(base_g + (GLOW_COLOR[1] - base_g) * glow)
            fb = round(base_b + (GLOW_COLOR[2] - base_b) * glow)
            px[x, y] = (fr, fg, fb, 255)
    return out


def build_preview() -> None:
    atlas = Image.open(ROSTER_PATH).convert("RGBA")
    x0, y0, x1, y1 = cell_rect(DOOR_OPEN_INDEX)
    before = atlas.crop((x0, y0, x1, y1))
    after = recolored_cell(before)

    zoom = 6
    pad = 12
    label_h = 20
    sheet = Image.new(
        "RGBA",
        (before.width * zoom * 2 + pad * 3, before.height * zoom + pad * 2 + label_h),
        (247, 239, 220, 255),
    )
    before_big = before.resize((before.width * zoom, before.height * zoom), Image.NEAREST)
    after_big = after.resize((after.width * zoom, after.height * zoom), Image.NEAREST)
    sheet.alpha_composite(before_big, (pad, pad + label_h))
    sheet.alpha_composite(after_big, (pad * 2 + before_big.width, pad + label_h))
    sheet.save(PREVIEW_OUT)
    print(f"saved preview: {PREVIEW_OUT}")


def apply() -> None:
    x0, y0, x1, y1 = cell_rect(DOOR_OPEN_INDEX)
    reference = Image.open(ROSTER_PATH).convert("RGBA")
    ref_before = reference.crop((x0, y0, x1, y1))
    ref_after = recolored_cell(ref_before)
    for path in ALL_PATHS:
        atlas = Image.open(path).convert("RGBA")
        before = atlas.crop((x0, y0, x1, y1))
        if list(before.getdata()) != list(ref_before.getdata()):
            raise SystemExit(
                f"{path}: door-open cell is not byte-identical to the roster reference; aborting."
            )
        atlas.paste(ref_after, (x0, y0))
        atlas.save(path, optimize=True)
        print(f"wrote {path}")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "--preview"
    if mode == "--preview":
        build_preview()
    elif mode == "--apply":
        apply()
    else:
        raise SystemExit(f"unknown mode {mode!r}; use --preview or --apply")
