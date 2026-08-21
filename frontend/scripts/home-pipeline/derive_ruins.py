"""Derive the 8-frame ruins.png set from the raw (un-aligned) collapsed state.

Ruin frames are drawn standalone (never alongside components.png frames), so
they don't need the shared master coordinate system -- just internal
consistency across the 8 variants.
"""

from __future__ import annotations

import random
import sys

sys.path.insert(0, "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/character-pipeline")

from pxutil import despeckle, mode_pool, snap_palette  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

WORK = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work"
OUT = f"{WORK}/ruins"
CELL = 128

HOME_RUIN_IDS = [
    "rubble-full", "rubble-full-scavenge", "rubble-picked", "rubble-picked-scavenge",
    "rubble-bare", "rubble-bare-scavenge", "collapse-debris", "snapshot-sweep-dissolve",
]

WOOD_HUES = range(15, 45)  # brown/tan hue band we treat as "wood" for bare-ification


def rgb_to_hsv_hue(r: int, g: int, b: int) -> float:
    import colorsys

    h, _s, _v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return h * 360


def fit_to_cell(img: Image.Image, max_dim: int = 120) -> Image.Image:
    pooled = mode_pool(img, max_dim if img.height >= img.width else round(max_dim * img.height / img.width))
    if pooled.width > max_dim:
        scale = max_dim / pooled.width
        pooled = pooled.resize((max_dim, max(1, round(pooled.height * scale))), Image.Resampling.NEAREST)
    cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    ox = (CELL - pooled.width) // 2
    oy = CELL - pooled.height - 4
    cell.alpha_composite(pooled, (ox, oy))
    return cell


def remove_wood(img: Image.Image, strength: float, rng: random.Random | None = None) -> Image.Image:
    """Desaturate/remove warm wood-brown pixels, simulating scavenged timber.

    strength in [0,1]: fraction of wood pixels dropped outright (alpha=0);
    remaining wood pixels are desaturated toward stone-gray so even the
    un-dropped wood reads as "picked over" rather than fresh timber.
    """
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
    bx, by = 96, 104
    d.polygon([(bx, by), (bx + 20, by), (bx + 17, by + 14), (bx + 3, by + 14)], fill=(120, 84, 46, 255), outline=(60, 40, 20, 255))
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
            # push toward moss green + fade alpha, more at the top (older/weathered)
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
    frames["rubble-picked"] = remove_wood(rubble_full, 0.5, rng)
    frames["rubble-bare"] = remove_wood(rubble_full, 1.0, rng)
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
