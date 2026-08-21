"""Crop the four hut-b reference states into separate tightly-bounded PNGs.

Scratch derivation step for H1 (house asset pathfinder). Not wired into any
build; run manually via venv/bin/python.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/character-pipeline")

from pxutil import bg_mask, crop_figure, find_figure_spans  # noqa: E402
from PIL import Image  # noqa: E402

SRC = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/assets/character-claude/roster/house-b-states.png"
OUT_DIR = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work"
NAMES = ["state1-construction", "state2-complete", "state3-breached", "state4-collapsed"]


def main() -> None:
    img = Image.open(SRC).convert("RGBA")
    mask = bg_mask(img, tol=32)
    spans = find_figure_spans(mask, min_gap=10)
    print(f"found {len(spans)} spans: {spans}")
    if len(spans) != 4:
        raise SystemExit(f"expected 4 states, found {len(spans)}")
    import os

    os.makedirs(OUT_DIR, exist_ok=True)
    for name, span in zip(NAMES, spans, strict=True):
        cropped = crop_figure(img, span, tol=32)
        cropped.save(f"{OUT_DIR}/{name}.png")
        print(name, cropped.size)


if __name__ == "__main__":
    main()
