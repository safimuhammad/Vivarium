"""Simulate HomeActor's #visual() stacking so we can eyeball real composites.

Mirrors HomeActor.ts #visual(): back = [foundation, post, wall, window,
hearth, chimney]; front = [roof, door]. Renders a few representative states.
"""

from __future__ import annotations

from PIL import Image

OUT = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work/components"
PREVIEW = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work/preview"
CELL = 128


def load(name: str) -> Image.Image:
    return Image.open(f"{OUT}/{name}.png").convert("RGBA")


def composite(back: list[str], front: list[str]) -> Image.Image:
    canvas = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    for name in [*back, *front]:
        canvas.alpha_composite(load(name), (0, 0))
    return canvas


SCENARIOS = {
    "normal-intact-cold": (
        ["foundation", "post", "wall-intact", "window-cold", "hearth-cold", "chimney"],
        ["roof-intact", "door-closed"],
    ),
    "normal-intact-warm": (
        ["foundation", "post", "wall-intact", "window-lit", "hearth-lit-1", "chimney"],
        ["roof-intact", "door-closed"],
    ),
    "damaged": (
        ["foundation", "post", "wall-cracked", "window-cold", "hearth-cold", "chimney"],
        ["roof-damaged", "door-breached"],
    ),
    "broken": (
        ["foundation", "post", "wall-broken", "window-broken", "hearth-cold", "chimney"],
        ["roof-damaged", "door-breached"],
    ),
    "build-foundation": (["foundation"], []),
    "build-post": (["foundation", "post"], []),
    "build-walls": (["foundation", "post", "wall-intact", "window-cold"], []),
    "build-hearth": (["foundation", "post", "wall-intact", "window-cold", "hearth-lit-1", "chimney"], []),
    "build-roof": (["foundation", "post", "wall-intact", "window-cold", "hearth-lit-1", "chimney"], ["roof-intact"]),
    "collapse-mid": (
        ["foundation", "post", "wall-falling", "window-broken", "chimney"],
        ["roof-falling", "door-falling"],
    ),
}

cols = 5
names = list(SCENARIOS.keys())
sheet = Image.new("RGBA", (cols * (CELL + 10) + 10, ((len(names) - 1) // cols + 1) * (CELL + 26) + 10), (247, 239, 220, 255))
from PIL import ImageDraw

d = ImageDraw.Draw(sheet)
for i, name in enumerate(names):
    back, front = SCENARIOS[name]
    img = composite(back, front)
    cx, cy = (i % cols) * (CELL + 10) + 10, (i // cols) * (CELL + 26) + 10
    checker = Image.new("RGBA", (CELL, CELL), (255, 255, 255, 255))
    for yy in range(0, CELL, 8):
        for xx in range(0, CELL, 8):
            if (xx // 8 + yy // 8) % 2 == 0:
                for py in range(yy, min(yy + 8, CELL)):
                    for px_ in range(xx, min(xx + 8, CELL)):
                        checker.putpixel((px_, py), (222, 222, 222, 255))
    checker.alpha_composite(img, (0, 0))
    sheet.alpha_composite(checker, (cx, cy))
    d.text((cx, cy + CELL + 2), name, fill=(20, 20, 20, 255))
sheet.save(f"{PREVIEW}/composite-simulation.png")
print("saved composite-simulation.png")
