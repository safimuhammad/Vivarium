"""Derive the 5-frame yards.png set (192x160 each).

The house-b reference has no ground/yard context to crop, so these are
authored directly in the shared derived palette (sampled from the finished
components), matching the material language (dirt, moss, stone) established
by the cropped architecture. Kept modest: a dirt/grass plot with a stone
path toward the south door-opening, per HomeYardManifest's southPort spec
(x in [80,112) is the walkable opening).
"""

from __future__ import annotations

import random
import sys

sys.path.insert(0, "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/character-pipeline")

from pxutil import despeckle  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

WORK = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work"
OUT = f"{WORK}/yards"
W, H = 192, 160

DIRT = (91, 78, 52, 255)
DIRT_DARK = (64, 56, 37, 255)
GRASS = (97, 90, 54, 255)
GRASS_LIGHT = (129, 120, 71, 255)
STONE = (188, 162, 120, 255)
STONE_LIGHT = (220, 206, 179, 255)
WOOD = (79, 60, 38, 255)
EMBER = (255, 170, 60, 255)


def base_plot(rng: random.Random, seed_variant: int) -> Image.Image:
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # rounded dirt/grass plot footprint, contact pivot at (96,112)
    d.ellipse([20, 60, 172, 148], fill=GRASS)
    d.ellipse([28, 64, 164, 142], fill=DIRT)
    # mottled texture dabs
    for _ in range(140):
        x = rng.randint(24, 168)
        y = rng.randint(62, 146)
        if (x - 96) ** 2 / (76**2) + (y - 104) ** 2 / (44**2) > 1:
            continue
        r = rng.randint(1, 3)
        color = rng.choice([GRASS, GRASS_LIGHT, DIRT_DARK, DIRT])
        d.ellipse([x - r, y - r, x + r, y + r], fill=color)
    # stone path toward the south port [80,112)
    for i, y in enumerate(range(112, 150, 9)):
        w_ = 26 - i * 2
        x0 = 96 - w_ // 2 + (rng.randint(-2, 2) if seed_variant else 0)
        d.rounded_rectangle([x0, y, x0 + w_, y + 6], radius=2, fill=STONE, outline=DIRT_DARK)
    # a couple of stray pebbles / tufts for variant flavor
    if seed_variant == 0:
        d.ellipse([54, 96, 60, 101], fill=STONE_LIGHT)
        d.ellipse([128, 90, 135, 96], fill=STONE_LIGHT)
        d.line([(70, 84), (70, 78)], fill=GRASS_LIGHT, width=2)
        d.line([(74, 86), (74, 80)], fill=GRASS_LIGHT, width=2)
    else:
        d.ellipse([118, 100, 126, 106], fill=STONE_LIGHT)
        d.ellipse([46, 108, 52, 113], fill=STONE)
        d.line([(120, 78), (120, 72)], fill=GRASS_LIGHT, width=2)
        d.line([(124, 80), (124, 74)], fill=GRASS_LIGHT, width=2)
    return img


def warm_overlay(rng: random.Random) -> Image.Image:
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for rad, alpha in [(30, 40), (20, 70), (11, 120), (5, 190)]:
        d.ellipse([96 - rad, 118 - rad // 2, 96 + rad, 118 + rad // 2], fill=(*EMBER[:3], alpha))
    return img


def hoarding_overlay() -> Image.Image:
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # small stashed sack + crate pile off to one side of the path
    d.rounded_rectangle([132, 118, 156, 136], radius=3, fill=WOOD, outline=(40, 33, 22, 255))
    d.polygon([(112, 138), (128, 138), (124, 122), (116, 122)], fill=(140, 118, 80, 255), outline=(40, 33, 22, 255))
    d.line([(116, 128), (124, 128)], fill=(90, 70, 44, 255), width=1)
    return img


def ruin_base(rng: random.Random) -> Image.Image:
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([20, 60, 172, 148], fill=GRASS)
    d.ellipse([28, 64, 164, 142], fill=DIRT)
    for _ in range(220):
        x = rng.randint(24, 168)
        y = rng.randint(62, 146)
        if (x - 96) ** 2 / (76**2) + (y - 104) ** 2 / (44**2) > 1:
            continue
        r = rng.randint(1, 3)
        color = rng.choice([GRASS, GRASS_LIGHT, DIRT_DARK, STONE, STONE_LIGHT])
        d.ellipse([x - r, y - r, x + r, y + r], fill=color)
    # scattered small rubble chunks, no clean path (overgrown)
    for _ in range(10):
        x = rng.randint(50, 142)
        y = rng.randint(100, 140)
        r = rng.randint(2, 4)
        d.ellipse([x - r, y - r, x + r, y + r], fill=STONE, outline=(40, 33, 22, 255))
    return img


def main() -> None:
    import os

    os.makedirs(OUT, exist_ok=True)
    rng = random.Random(20260724)

    frames = {
        "standing-a-base": base_plot(rng, 0),
        "standing-b-base": base_plot(rng, 1),
        "warm-overlay": warm_overlay(rng),
        "durable-hoarding-overlay": hoarding_overlay(),
        "persistent-ruin-base": ruin_base(rng),
    }
    names = list(frames.keys())
    despeckled = {name: despeckle(img, passes=1) for name, img in frames.items()}
    for name, img in despeckled.items():
        img.save(f"{OUT}/{name}.png")

    atlas = Image.new("RGBA", (5 * W, H), (0, 0, 0, 0))
    for i, name in enumerate(names):
        atlas.alpha_composite(despeckled[name], (i * W, 0))
    atlas.save(f"{WORK}/yards-atlas.png")

    sheet = Image.new("RGBA", (5 * (W + 8) + 8, H + 24), (247, 239, 220, 255))
    d = ImageDraw.Draw(sheet)
    for i, name in enumerate(names):
        cx = i * (W + 8) + 8
        sheet.alpha_composite(despeckled[name], (cx, 4))
        d.text((cx, H + 6), name, fill=(20, 20, 20, 255))
    sheet.save(f"{WORK}/preview/yards-full.png")
    print("saved", len(names), "yard frames")


if __name__ == "__main__":
    main()
