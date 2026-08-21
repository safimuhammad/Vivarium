"""Crop the four owner-approved sprite-scale hut reference states into
separate tightly-bounded PNGs.

Source: frontend/assets/character-claude/roster/hut-sprite-states.png
(Safi-approved 2026-07-24 replacement for the prior detailed
house-b-states.png reference -- see .superpowers/sdd/progress.md "SAFI
RETURNED" section). Four states, left to right: (1) timber-frame
construction on a stone footing, (2) COMPLETE stone+turf hut with arched
door + glowing window, (3) BREACHED with a jagged wall hole + broken door,
(4) COLLAPSED ruin with chimney stub + moss.

Scratch derivation step for the hut-worldwide task. Not wired into any
build; run manually via venv/bin/python.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/character-pipeline")

from pxutil import bg_mask, crop_figure, find_figure_spans  # noqa: E402
from PIL import Image  # noqa: E402

SRC = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/assets/character-claude/roster/hut-sprite-states.png"
OUT_DIR = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work-sprite"
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
