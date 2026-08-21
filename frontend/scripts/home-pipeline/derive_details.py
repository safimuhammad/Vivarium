"""Derive the details.png badge atlas (32x32 x 32 slots, 8 cols x 4 rows).

Only the slots HomeActor.makeMarks() actually references get authored
content (0 owner, 1-4 stakeholders, 5 vault, 6 hoarding, 7 breacher, 9 loot,
10 claim) -- matching the existing production kits' convention of leaving
unused reserved slots blank/transparent.
"""

from __future__ import annotations

import sys

sys.path.insert(
    0, "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/character-pipeline"
)

from PIL import Image, ImageDraw
from pxutil import despeckle

WORK = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work"
OUT = f"{WORK}/details"
CELL = 32
COLS, ROWS = 8, 4

INK = (40, 33, 22, 255)
STONE = (188, 162, 120, 255)
STONE_LIGHT = (220, 206, 179, 255)
WOOD = (79, 60, 38, 255)
GOLD = (214, 168, 74, 255)
RED = (168, 46, 40, 255)
GREEN = (110, 122, 62, 255)
BLUE = (70, 96, 120, 255)
PURPLE = (120, 84, 130, 255)


def canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def owner_badge() -> Image.Image:
    img, d = canvas()
    d.polygon(
        [(16, 6), (24, 14), (21, 14), (21, 22), (11, 22), (11, 14), (8, 14)], fill=GOLD, outline=INK
    )
    d.rectangle([13, 22, 19, 25], fill=WOOD, outline=INK)
    return img


def stakeholder_badge(color: tuple[int, int, int, int]) -> Image.Image:
    img, d = canvas()
    d.polygon([(10, 6), (24, 6), (24, 12), (17, 15), (10, 12)], fill=color, outline=INK)
    d.rectangle([15, 12, 18, 26], fill=WOOD, outline=INK)
    return img


def vault_badge() -> Image.Image:
    img, d = canvas()
    d.rectangle([7, 14, 25, 25], fill=WOOD, outline=INK)
    d.rectangle([7, 10, 25, 15], fill=STONE, outline=INK)
    d.ellipse([14, 16, 18, 20], fill=GOLD, outline=INK)
    return img


def hoarding_badge() -> Image.Image:
    img, d = canvas()
    d.polygon([(9, 12), (23, 12), (25, 27), (7, 27)], fill=WOOD, outline=INK)
    d.line([(9, 12), (13, 5), (19, 5), (23, 12)], fill=(140, 118, 80, 255), width=2)
    d.ellipse([13, 8, 19, 13], fill=GOLD, outline=INK)
    return img


def breacher_badge() -> Image.Image:
    img, d = canvas()
    d.line([(8, 8), (24, 24)], fill=RED, width=3)
    d.line([(24, 8), (8, 24)], fill=RED, width=3)
    d.ellipse([6, 6, 26, 26], outline=INK, width=1)
    return img


def loot_badge() -> Image.Image:
    img, d = canvas()
    d.polygon([(9, 14), (23, 14), (21, 26), (11, 26)], fill=GOLD, outline=INK)
    d.line([(9, 14), (12, 7), (20, 7), (23, 14)], fill=(150, 118, 40, 255), width=2)
    return img


def claim_badge() -> Image.Image:
    img, d = canvas()
    d.rectangle([15, 6, 17, 27], fill=WOOD, outline=INK)
    d.polygon([(17, 7), (26, 10), (17, 14)], fill=BLUE, outline=INK)
    return img


def main() -> None:
    import os

    os.makedirs(OUT, exist_ok=True)
    slots: dict[int, Image.Image] = {
        0: owner_badge(),
        1: stakeholder_badge(GREEN),
        2: stakeholder_badge(BLUE),
        3: stakeholder_badge(PURPLE),
        4: stakeholder_badge(STONE_LIGHT),
        5: vault_badge(),
        6: hoarding_badge(),
        7: breacher_badge(),
        9: loot_badge(),
        10: claim_badge(),
    }
    frames = [slots.get(i, Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))) for i in range(32)]
    frames = [despeckle(f, passes=1) if f.getbbox() else f for f in frames]
    for i, img in enumerate(frames):
        img.save(f"{OUT}/home-detail-{i}.png")

    atlas = Image.new("RGBA", (COLS * CELL, ROWS * CELL), (0, 0, 0, 0))
    for i, img in enumerate(frames):
        cx, cy = (i % COLS) * CELL, (i // COLS) * CELL
        atlas.alpha_composite(img, (cx, cy))
    atlas.save(f"{WORK}/details-atlas.png")

    zoom = 3
    sheet = Image.new("RGBA", (COLS * CELL * zoom, ROWS * CELL * zoom), (247, 239, 220, 255))
    big = atlas.resize((atlas.width * zoom, atlas.height * zoom), Image.Resampling.NEAREST)
    sheet.alpha_composite(big, (0, 0))
    d = ImageDraw.Draw(sheet)
    for i in slots:
        cx, cy = (i % COLS) * CELL * zoom, (i // COLS) * CELL * zoom
        d.rectangle(
            [cx, cy, cx + CELL * zoom - 1, cy + CELL * zoom - 1], outline=(200, 40, 40, 255)
        )
    sheet.save(f"{WORK}/preview/details-full.png")
    print("saved 32 detail slots (", len(slots), "authored )")


if __name__ == "__main__":
    main()
