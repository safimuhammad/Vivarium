"""Preview candidate SCALE/OFFSET transforms for the sprite-scale hut
whole-frame derivation before committing to final component atlases.
"""

from __future__ import annotations

import sys

sys.path.insert(
    0, "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/character-pipeline"
)

from PIL import Image, ImageDraw
from pxutil import despeckle, mode_pool

WORK = (
    "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work-sprite"
)
CELL = 128
CREAM = (243, 235, 214)
CREAM_TOL = 30
NAMES = ["state1-construction", "state2-complete", "state3-breached", "state4-collapsed"]


def key_out_cream(
    img: Image.Image, cream: tuple[int, int, int] = CREAM, tol: int = CREAM_TOL
) -> Image.Image:
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    opx = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if abs(r - cream[0]) <= tol and abs(g - cream[1]) <= tol and abs(b - cream[2]) <= tol:
                continue
            opx[x, y] = (r, g, b, a)
    return out


def whole_frame(state: str, scale: float, ox: int, oy: int) -> Image.Image:
    img = Image.open(f"{WORK}/{state}-aligned.png").convert("RGBA")
    img = key_out_cream(img)
    w, h = img.size
    tw, th = round(w * scale), round(h * scale)
    pooled = mode_pool(img, th)
    if pooled.width != tw and pooled.width > 0:
        pooled = pooled.resize((tw, th), Image.Resampling.NEAREST)
    pooled = despeckle(pooled, passes=1)
    canvas = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    canvas.paste(pooled, (ox, oy), pooled)
    return canvas, pooled.size


def main() -> None:
    scale = 0.335
    ox, oy = 8, -2
    checker = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    px = checker.load()
    for y in range(CELL):
        for x in range(CELL):
            px[x, y] = (60, 60, 60, 255) if (x // 8 + y // 8) % 2 == 0 else (90, 90, 90, 255)

    sheet = Image.new("RGBA", (len(NAMES) * (CELL * 3 + 10) + 10, CELL * 3 + 40), (30, 30, 30, 255))
    d = ImageDraw.Draw(sheet)
    for i, name in enumerate(NAMES):
        frame, size = whole_frame(name, scale, ox, oy)
        composite = Image.alpha_composite(checker.copy(), frame)
        big = composite.resize((CELL * 3, CELL * 3), Image.Resampling.NEAREST)
        x = i * (CELL * 3 + 10) + 10
        sheet.alpha_composite(big, (x, 10))
        d.text((x, CELL * 3 + 14), f"{name} {size}", fill=(255, 255, 255, 255))
        frame.save(f"{WORK}/preview/candidate-{name}.png")
    sheet.save(f"{WORK}/preview/candidate-sheet.png")
    print("scale", scale, "offset", (ox, oy))


if __name__ == "__main__":
    main()
