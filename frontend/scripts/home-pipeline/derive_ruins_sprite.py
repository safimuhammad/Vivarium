"""Derive the 8-frame ruins.png set from the sprite-scale collapsed-state
reference (state4-collapsed). Ruin frames are drawn standalone (never
alongside components.png frames), so each is just centered/anchored in its
own 128x128 cell -- no shared master coordinate system needed.
"""

from __future__ import annotations

import random
import sys

sys.path.insert(0, "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/character-pipeline")

from pxutil import despeckle, mode_pool, snap_palette  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

WORK = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work-sprite"
OUT = f"{WORK}/ruins"
CELL = 128
CREAM = (243, 235, 214)
CREAM_TOL = 34

HOME_RUIN_IDS = [
    "rubble-full", "rubble-full-scavenge", "rubble-picked", "rubble-picked-scavenge",
    "rubble-bare", "rubble-bare-scavenge", "collapse-debris", "snapshot-sweep-dissolve",
]


def key_out_cream(img: Image.Image, cream: tuple[int, int, int] = CREAM, tol: int = CREAM_TOL) -> Image.Image:
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


def close_holes(img: Image.Image, passes: int = 2) -> Image.Image:
    from collections import Counter

    out = img.copy()
    w, h = out.size
    for _ in range(passes):
        px = out.load()
        edits: list[tuple[int, int, tuple[int, int, int, int]]] = []
        for y in range(h):
            for x in range(w):
                if px[x, y][3] > 0:
                    continue
                ring = [
                    px[nx, ny]
                    for nx in range(x - 1, x + 2)
                    for ny in range(y - 1, y + 2)
                    if (nx, ny) != (x, y) and 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] > 0
                ]
                if len(ring) >= 6:
                    edits.append((x, y, Counter(ring).most_common(1)[0][0]))
        for x, y, c in edits:
            out.putpixel((x, y), c)
    return out


def rgb_to_hsv_hue(r: int, g: int, b: int) -> float:
    import colorsys

    h, _s, _v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return h * 360


def fit_to_cell(img: Image.Image, max_dim: int = 118) -> Image.Image:
    img = key_out_cream(img)
    bbox = img.getbbox()
    assert bbox is not None
    cropped = img.crop(bbox)
    scale = max_dim / max(cropped.size)
    th = round(cropped.height * scale)
    pooled = mode_pool(cropped, th)
    tw = round(cropped.width * scale)
    if pooled.width != tw and pooled.width > 0:
        pooled = pooled.resize((tw, th), Image.Resampling.NEAREST)
    pooled = close_holes(pooled)
    pooled = despeckle(pooled, passes=1)
    cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    ox = (CELL - pooled.width) // 2
    oy = CELL - pooled.height - 4
    cell.alpha_composite(pooled, (ox, oy))
    return cell


def remove_wood(img: Image.Image, strength: float, rng: random.Random | None = None) -> Image.Image:
    """Desaturate/remove warm wood-brown pixels, simulating scavenged timber."""
    out = img.copy()
    px = out.load()
    w, h = out.size
    local_rng = rng or random.Random(7)
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            hue = rgb_to_hsv_hue(r, g, b)
            is_wood = 12 <= hue <= 42 and r > g > b and (r - b) > 25
            if is_wood:
                if local_rng.random() < strength:
                    px[x, y] = (0, 0, 0, 0)
                else:
                    gray = int(0.3 * r + 0.59 * g + 0.11 * b)
                    blend = min(1.0, strength + 0.25)
                    nr = int(r + (gray - r) * blend)
                    ng = int(g + (gray - g) * blend)
                    nb = int(b + (gray - b) * blend)
                    px[x, y] = (nr, ng, nb, a)
    return out


def add_basket(img: Image.Image) -> Image.Image:
    out = img.copy()
    d = ImageDraw.Draw(out)
    bx, by = 92, 100
    d.polygon(
        [(bx, by), (bx + 20, by), (bx + 17, by + 14), (bx + 3, by + 14)],
        fill=(120, 84, 46, 255),
        outline=(60, 40, 20, 255),
    )
    d.line([(bx + 4, by), (bx + 10, by - 7), (bx + 16, by)], fill=(90, 60, 32, 255), width=1)
    return out


def dust_cloud(img: Image.Image, rng: random.Random) -> Image.Image:
    out = img.copy()
    d = ImageDraw.Draw(out)
    for _ in range(60):
        x = rng.randint(10, 118)
        y = rng.randint(40, 122)
        r = rng.randint(1, 3)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(200, 195, 180, rng.randint(40, 110)))
    return out


def dissolve(img: Image.Image, rng: random.Random) -> Image.Image:
    out = img.copy()
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            fade = 0.55 + 0.35 * (y / h)
            nr = int(r * 0.75 + 70 * 0.25)
            ng = int(g * 0.85 + 96 * 0.15)
            nb = int(b * 0.8 + 60 * 0.2)
            na = int(a * fade)
            if rng.random() < 0.06:
                na = 0
            px[x, y] = (nr, ng, nb, na)
    return out


def main() -> None:
    import os

    os.makedirs(OUT, exist_ok=True)
    rng = random.Random(20260724)
    raw = Image.open(f"{WORK}/state4-collapsed.png").convert("RGBA")
    rubble_full = fit_to_cell(raw)

    frames: dict[str, Image.Image] = {}
    frames["rubble-full"] = rubble_full
    frames["rubble-picked"] = close_holes(remove_wood(rubble_full, 0.45, rng), passes=1)
    frames["rubble-bare"] = close_holes(remove_wood(rubble_full, 0.85, rng), passes=1)
    frames["rubble-full-scavenge"] = add_basket(frames["rubble-full"])
    frames["rubble-picked-scavenge"] = add_basket(frames["rubble-picked"])
    frames["rubble-bare-scavenge"] = add_basket(frames["rubble-bare"])
    frames["collapse-debris"] = dust_cloud(rubble_full, rng)
    frames["snapshot-sweep-dissolve"] = dissolve(frames["rubble-bare"], rng)

    ordered = [frames[name] for name in HOME_RUIN_IDS]
    snapped = snap_palette(ordered, colors=20)
    despeckled = [despeckle(img, passes=1) for img in snapped]
    for name, img in zip(HOME_RUIN_IDS, despeckled, strict=True):
        img.save(f"{OUT}/{name}.png")

    cols, rows = 4, 2
    atlas = Image.new("RGBA", (cols * CELL, rows * CELL), (0, 0, 0, 0))
    for i, name in enumerate(HOME_RUIN_IDS):
        cx, cy = (i % cols) * CELL, (i // cols) * CELL
        atlas.alpha_composite(despeckled[i], (cx, cy))
    atlas.save(f"{WORK}/ruins-atlas.png")

    sheet = Image.new("RGBA", (cols * (CELL + 6) + 6, rows * (CELL + 20) + 6), (247, 239, 220, 255))
    d = ImageDraw.Draw(sheet)
    for i, name in enumerate(HOME_RUIN_IDS):
        cx, cy = (i % cols) * (CELL + 6) + 6, (i // cols) * (CELL + 20) + 6
        sheet.alpha_composite(despeckled[i], (cx, cy))
        d.text((cx, cy + CELL + 2), name, fill=(20, 20, 20, 255))
    sheet.save(f"{WORK}/preview/ruins-full.png")
    print("saved", len(HOME_RUIN_IDS), "ruin frames")


if __name__ == "__main__":
    main()
