"""Hand-touch pass for the chibi front sprite: proper eyes, smile, clean strap.

Coordinates from the ASCII map of sprites-chibi/front.png (22x48).
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

DIR = Path(__file__).parent / "sprites-chibi"

SKIN = (227, 150, 74, 255)         # 'i'
SKIN_SHADE = (225, 162, 91, 255)   # 'm'
PUPIL = (40, 23, 13, 255)          # 'j'
WHITE = (248, 225, 182, 255)       # 'l' — shirt cream doubles as eye highlight
SHIRT = (248, 225, 182, 255)
LEATHER = (134, 74, 36, 255)       # 'b' — strap/pouch mid
LEATHER_NOISE = {(108, 70, 38, 255), (137, 92, 41, 255), (134, 74, 36, 255),
                 (92, 49, 23, 255), (68, 36, 21, 255)}   # k d b c g


def main() -> None:
    img = Image.open(DIR / "front.png").convert("RGBA")
    px = img.load()

    # -- eyes: symmetric 2x3 pupils (cols 6-7 / 13-14, rows 12-14), highlight top --
    for y in (12, 13, 14):
        for x in range(4, 18):
            if px[x, y] == PUPIL or px[x, y][3] == 0:    # also fills the face hole
                px[x, y] = SKIN
    for x in (6, 7, 13, 14):
        for y in (12, 13, 14):
            px[x, y] = PUPIL
    px[6, 12] = WHITE                                     # eye highlights
    px[13, 12] = WHITE

    # -- gentle smile --
    px[10, 17] = SKIN_SHADE
    px[11, 17] = SKIN_SHADE

    # -- strap: erase scattered leather across the torso, redraw one diagonal --
    for y in range(21, 30):
        for x in range(5, 17):
            if px[x, y] in LEATHER_NOISE:
                px[x, y] = SHIRT
    diagonal = {21: (14, 15), 22: (13, 14), 23: (12, 13), 24: (11, 12),
                25: (10, 11), 26: (9, 10), 27: (8, 9), 28: (7, 8), 29: (7, 8)}
    for y, cols in diagonal.items():
        for x in cols:
            if px[x, y][3] > 0 and px[x, y] == SHIRT:     # ride over shirt only
                px[x, y] = LEATHER

    img.save(DIR / "front.png")
    img.resize((img.size[0] * 16, img.size[1] * 16), Image.Resampling.NEAREST) \
       .save(DIR / "front-16x.png")
    print("chibi front touched up; wrote front-16x.png")


if __name__ == "__main__":
    main()
