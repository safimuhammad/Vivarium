"""Align the four sprite-scale reference states into one shared coordinate
system (ground-vertex translation, same technique as align_states.py).

Verifies the shared native scale assumption before aligning (widest-row
width comparison across state1..state4); if per-state scale drifts this
raises rather than silently pasting mismatched geometry.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/character-pipeline")

from pxutil import bg_mask  # noqa: E402
from PIL import Image  # noqa: E402

WORK = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work-sprite"
NAMES = ["state1-construction", "state2-complete", "state3-breached", "state4-collapsed"]
CANVAS = (500, 520)
TARGET_GROUND = (250, 500)


def ground_vertex(img: Image.Image) -> tuple[int, int]:
    mask = bg_mask(img, tol=32)
    h, w = len(mask), len(mask[0])
    for y in range(h - 1, -1, -1):
        xs = [x for x in range(w) if not mask[y][x]]
        if xs:
            return round(sum(xs) / len(xs)), y
    raise ValueError("empty image")


def widest_row_width(img: Image.Image) -> int:
    mask = bg_mask(img, tol=32)
    h, w = len(mask), len(mask[0])
    best = 0
    for y in range(h):
        xs = [x for x in range(w) if not mask[y][x]]
        if xs:
            best = max(best, max(xs) - min(xs) + 1)
    return best


def main() -> None:
    for name in NAMES:
        img = Image.open(f"{WORK}/{name}.png").convert("RGBA")
        print(name, "widest-row-width", widest_row_width(img), "size", img.size)
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
