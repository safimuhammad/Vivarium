"""Align the four cropped states into one shared coordinate system.

Each state is pasted into a fixed-size padded canvas such that its ground
vertex (bottom-most opaque pixel, i.e. the point of the isometric hut closest
to the ground/viewer) lands at the same target pixel. Because all four
reference renders share the same native scale (verified: state1/state2
widest-row widths are 331 vs 337 px), no additional rescale is needed here --
just translation. This lets every downstream component crop use one shared
rectangle across all states.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/character-pipeline")

from pxutil import bg_mask  # noqa: E402
from PIL import Image  # noqa: E402

WORK = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work"
NAMES = ["state1-construction", "state2-complete", "state3-breached", "state4-collapsed"]
CANVAS = (420, 460)
TARGET_GROUND = (210, 400)


def ground_vertex(img: Image.Image) -> tuple[int, int]:
    mask = bg_mask(img, tol=32)
    h, w = len(mask), len(mask[0])
    for y in range(h - 1, -1, -1):
        xs = [x for x in range(w) if not mask[y][x]]
        if xs:
            return round(sum(xs) / len(xs)), y
    raise ValueError("empty image")


def main() -> None:
    for name in NAMES:
        img = Image.open(f"{WORK}/{name}.png").convert("RGBA")
        gx, gy = ground_vertex(img)
        ox, oy = TARGET_GROUND[0] - gx, TARGET_GROUND[1] - gy
        canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
        canvas.alpha_composite(img, (ox, oy))
        canvas.save(f"{WORK}/{name}-aligned.png")
        print(name, "ground", (gx, gy), "-> offset", (ox, oy))


if __name__ == "__main__":
    main()
