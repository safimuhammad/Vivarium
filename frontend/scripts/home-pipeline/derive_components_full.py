"""Complete the 24-frame components.png set: add pieces the reference lacks.

Reuses the 14 directly-derived pieces from derive_components.py and adds the
10 remaining via pixel edits on top of those bases (crack overlays, punched
voids, motion-blur duplication, small authored hearth/dust motifs), matching
the H1 STEP 2 "derive via pixel edits" instruction. Then unifies the whole
24-frame set onto one shared palette and despeckles, and assembles the
768x512 6x4 components.png atlas.
"""

from __future__ import annotations

import random
import sys

sys.path.insert(
    0, "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/character-pipeline"
)

import derive_components as dc
from PIL import Image, ImageDraw
from pxutil import despeckle, snap_palette

WORK = dc.WORK
OUT = dc.OUT
CELL = 128

HOME_COMPONENT_IDS = [
    "foundation",
    "post",
    "wall-intact",
    "wall-cracked",
    "wall-broken",
    "wall-falling",
    "roof-intact",
    "roof-damaged",
    "roof-falling",
    "door-closed",
    "door-opening-1",
    "door-opening-2",
    "door-opening-3",
    "door-open",
    "door-breached",
    "door-falling",
    "window-cold",
    "window-lit",
    "window-broken",
    "hearth-cold",
    "hearth-lit-1",
    "hearth-lit-2",
    "chimney",
    "dust",
]


def darken(img: Image.Image, factor: float) -> Image.Image:
    out = img.copy()
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (int(r * factor), int(g * factor), int(b * factor), a)
    return out


def punch_void(
    img: Image.Image,
    rng: random.Random,
    cx: int,
    cy: int,
    radius: int,
    void_color: tuple[int, int, int, int],
) -> Image.Image:
    """Carve a rough dark void (breach hole) centered at (cx, cy)."""
    out = img.copy()
    px = out.load()
    w, h = out.size
    for y in range(max(0, cy - radius), min(h, cy + radius)):
        for x in range(max(0, cx - radius), min(w, cx + radius)):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            jitter = rng.uniform(-2.5, 2.5)
            if d + jitter < radius and px[x, y][3] > 0:
                px[x, y] = void_color
    return out


def add_crack(
    img: Image.Image,
    rng: random.Random,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    color: tuple[int, int, int, int],
) -> Image.Image:
    out = img.copy()
    px = out.load()
    w, h = out.size
    steps = max(abs(x1 - x0), abs(y1 - y0)) * 2
    x, y = x0, y0
    for i in range(steps):
        t = i / max(1, steps)
        x = round(x0 + (x1 - x0) * t + rng.uniform(-1.5, 1.5))
        y = round(y0 + (y1 - y0) * t + rng.uniform(-1.5, 1.5))
        for dx in (0, 1):
            for dy in (0, 1):
                xx, yy = x + dx, y + dy
                if 0 <= xx < w and 0 <= yy < h and px[xx, yy][3] > 0:
                    px[xx, yy] = color
    return out


def paste(base: Image.Image, patch: Image.Image, at: tuple[int, int]) -> Image.Image:
    out = base.copy()
    out.alpha_composite(patch, at)
    return out


def build_extra(frames: dict[str, Image.Image]) -> None:
    rng = random.Random(20260724)
    true_gap = (0, 0, 0, 0)
    crack_color = (28, 22, 18, 255)

    # wall-broken: wall-cracked with real punched-through gaps (alpha=0, not
    # just a dark tint -- the source art is already dark/speckled, so a
    # recolored "void" was visually indistinguishable from existing shadow
    # texture) in each remaining stone pier, plus the top band shortened to
    # suggest partial collapse.
    wb = frames["wall-cracked"].copy()
    wb = punch_void(wb, rng, cx=29, cy=92, radius=10, void_color=true_gap)
    wb = punch_void(wb, rng, cx=100, cy=102, radius=8, void_color=true_gap)
    px = wb.load()
    for x in range(46, 90):
        for y in range(58, 70):
            px[x, y] = (0, 0, 0, 0)
    wb = add_crack(wb, rng, 26, 62, 32, 88, crack_color)
    wb = add_crack(wb, rng, 92, 62, 100, 96, crack_color)
    frames["wall-broken"] = wb

    # door-open: door-closed with the leaf carved to a dark gap + jamb kept.
    do = frames["door-closed"].copy()
    px = do.load()
    for y in range(60, 122):
        for x in range(46, 74):
            if px[x, y][3] > 0:
                px[x, y] = (14, 12, 10, 255)
    frames["door-open"] = do

    # door-opening-1/2/3: progressive build stages, blending post -> door-closed
    base_post = frames["post"]
    base_door = frames["door-closed"]
    for stage, alpha in zip((1, 2, 3), (0.35, 0.65, 0.9), strict=True):
        stage_img = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        stage_img.alpha_composite(base_post, (0, 0))
        blended = base_door.copy()
        bpx = blended.load()
        for y in range(CELL):
            for x in range(CELL):
                r, g, b, a = bpx[x, y]
                if a:
                    bpx[x, y] = (r, g, b, int(a * alpha))
        stage_img.alpha_composite(blended, (0, 0))
        frames[f"door-opening-{stage}"] = stage_img

    # window-broken: window-cold + shatter cracks + darken.
    wbroke = frames["window-cold"].copy()
    wbroke = darken(wbroke, 0.75)
    wbroke = add_crack(wbroke, rng, 84, 72, 96, 88, (10, 10, 10, 255))
    wbroke = add_crack(wbroke, rng, 90, 70, 82, 90, (10, 10, 10, 255))
    frames["window-broken"] = wbroke

    # hearth-cold / hearth-lit-1 / hearth-lit-2: small authored nook motif,
    # placed near the door threshold (an ember pit), stone-framed.
    def hearth(glow: float) -> Image.Image:
        img = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        # small stone hearth ring at the foundation line
        d.rectangle([56, 108, 76, 118], fill=(96, 92, 84, 255))
        d.rectangle([58, 110, 74, 116], fill=(40, 36, 32, 255))
        if glow > 0:
            for rad, col in [
                (9, (255, 140, 40, int(90 * glow))),
                (6, (255, 170, 60, int(160 * glow))),
                (3, (255, 210, 120, int(220 * glow))),
            ]:
                cx, cy = 66, 113
                d.ellipse([cx - rad, cy - rad - 2, cx + rad, cy + rad - 2], fill=col)
        return img

    frames["hearth-cold"] = hearth(0.0)
    frames["hearth-lit-1"] = hearth(1.0)
    frames["hearth-lit-2"] = hearth(0.8)

    # dust: light debris/settling scatter, small stone chips near the base.
    dust = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    d = ImageDraw.Draw(dust)
    chip_colors = [(168, 158, 140, 210), (140, 128, 112, 200), (190, 182, 166, 190)]
    for _ in range(26):
        x = rng.randint(20, 108)
        y = rng.randint(96, 116)
        r = rng.randint(1, 2)
        d.ellipse([x - r, y - r, x + r, y + r], fill=rng.choice(chip_colors))
    frames["dust"] = dust


def main() -> None:
    frames: dict[str, Image.Image] = {}
    for name in [
        "foundation",
        "post",
        "wall-intact",
        "wall-cracked",
        "roof-intact",
        "roof-damaged",
        "door-closed",
        "door-breached",
        "window-cold",
        "window-lit",
        "chimney",
        "roof-falling",
        "wall-falling",
        "door-falling",
    ]:
        frames[name] = Image.open(f"{OUT}/{name}.png").convert("RGBA")

    build_extra(frames)

    ordered = [frames[name] for name in HOME_COMPONENT_IDS]
    snapped = snap_palette(ordered, colors=22)
    despeckled = [despeckle(img, passes=1) for img in snapped]
    for name, img in zip(HOME_COMPONENT_IDS, despeckled, strict=True):
        img.save(f"{OUT}/{name}.png")

    # assemble 6x4 atlas
    cols, rows = 6, 4
    atlas = Image.new("RGBA", (cols * CELL, rows * CELL), (0, 0, 0, 0))
    for i in range(len(HOME_COMPONENT_IDS)):
        cx, cy = (i % cols) * CELL, (i // cols) * CELL
        atlas.alpha_composite(despeckled[i], (cx, cy))
    atlas.save(f"{WORK}/components-atlas.png")

    # contact sheet with labels on cream bg
    sheet = Image.new("RGBA", (cols * (CELL + 6) + 6, rows * (CELL + 20) + 6), (247, 239, 220, 255))
    d = ImageDraw.Draw(sheet)
    for i, name in enumerate(HOME_COMPONENT_IDS):
        cx, cy = (i % cols) * (CELL + 6) + 6, (i // cols) * (CELL + 20) + 6
        sheet.alpha_composite(despeckled[i], (cx, cy))
        d.text((cx, cy + CELL + 2), name, fill=(20, 20, 20, 255))
    sheet.save(f"{WORK}/preview/components-full.png")
    print("saved", len(HOME_COMPONENT_IDS), "frames")


if __name__ == "__main__":
    main()
