"""Slice the 3-view reference sheet and grid-quantize each view to a true sprite.

Usage: python quantize.py <reference.png> <out_dir> [target_height]
Writes front.png / back.png / side.png plus preview.png (8x contact sheet).
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image
from pxutil import (
    bg_mask,
    contact_sheet,
    crop_figure,
    despeckle,
    find_figure_spans,
    mode_pool,
    snap_palette,
)

VIEW_NAMES = ["front", "back", "side"]


def main() -> None:
    src_path, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    target_h = int(sys.argv[3]) if len(sys.argv) > 3 else 48
    out_dir.mkdir(parents=True, exist_ok=True)

    ref = Image.open(src_path).convert("RGBA")
    spans = find_figure_spans(bg_mask(ref))
    print(f"figure spans: {spans}")
    if len(spans) != len(VIEW_NAMES):
        print(f"WARNING: expected 3 figures, found {len(spans)} — check preview")

    sprites = []
    for span in spans[: len(VIEW_NAMES)]:
        fig = crop_figure(ref, span)
        sprites.append(mode_pool(fig, target_h))
    sprites = [despeckle(s) for s in snap_palette(sprites, colors=16)]

    # strict=False: sprites can be shorter than VIEW_NAMES when fewer figure
    # spans were detected than expected (see the WARNING above) — the script
    # still writes whatever views it found rather than hard-failing.
    for name, sprite in zip(VIEW_NAMES, sprites, strict=False):
        sprite.save(out_dir / f"{name}.png")
        print(f"{name}: {sprite.size[0]}x{sprite.size[1]}")
    contact_sheet(sprites).save(out_dir / "preview.png")
    print(f"wrote {out_dir}/preview.png")


if __name__ == "__main__":
    main()
