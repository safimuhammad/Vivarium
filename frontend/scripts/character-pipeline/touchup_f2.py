"""Hand-touch pass for the F2 (deep-brown-skin, bun) front sprite.

F2-specific variant of `touchup_chibi.py`/`touchup_f1.py`. Coordinates come
from an ASCII map + raw-pixel dump of `roster/f2-sprites/front.png` (16x48)
— see `ROSTER_PIPELINE_NOTES.md` for the general method.

Unlike F1's already-symmetric two-blob quantize, F2's raw quantize produced
an *asymmetric* pair: a wide near-black blob bleeding from the (heavier,
character-right) hair bang on one side (cols 2-5, rows 9-13, mixing two
near-black tones) and a single isolated hair-black column standing in for
the other eye (col 10, rows 13-15) — a real artifact of the source art's
asymmetric bang, not two comparable eye shapes. Per the roster-integration
method ("pick pupil columns symmetric around the sprite's true center, not
the raw blob's own center"), both raw blobs are cleared back to skin and
replaced with a fresh symmetric pair.

F2's palette has no cream/white tone (terracotta top, brown trousers, deep
skin) — the lightest available color is the skin tone itself, so the
highlight pixel reuses skin-main (matching m1/F1's "reuse an existing light
color" rule, just with skin standing in for a cream that doesn't exist here).
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

DIR = Path(__file__).parent.parent.parent / "assets/character-claude/roster/f2-sprites"

SKIN = (168, 98, 44, 255)
PUPIL = (18, 18, 18, 255)           # the near-black tone quantize already used for the eye blobs
HIGHLIGHT = SKIN                    # no cream in F2's palette; skin is the lightest tone available

# Raw eye-blob pixels to clear back to skin, found by direct pixel dump (not
# a blind color-band clear — F2's hairline reuses one of the eye-blob tones,
# so a band clear would notch the bang silhouette; see ROSTER_PIPELINE_NOTES.md).
RAW_LEFT_BLOB = {
    (3, 10), (4, 9), (4, 10), (3, 11), (4, 11),
    (2, 12), (3, 12), (4, 12), (5, 12), (2, 13), (3, 13), (4, 13), (5, 13),
    (3, 14), (4, 14), (5, 14), (4, 15), (5, 15),
}
RAW_RIGHT_BLOB = {(14, 12), (14, 13), (10, 13), (10, 14), (10, 15)}

# New symmetric pupils, centered on the sprite's true center (width-1)/2 = 7.5,
# not on either raw blob's own (very asymmetric) center.
EYE_ROWS = (11, 12, 13)
LEFT_EYE_COLS = (5, 6)
RIGHT_EYE_COLS = (9, 10)


def main() -> None:
    img = Image.open(DIR / "front.png").convert("RGBA")
    px = img.load()

    for x, y in RAW_LEFT_BLOB | RAW_RIGHT_BLOB:
        px[x, y] = SKIN

    for x in (*LEFT_EYE_COLS, *RIGHT_EYE_COLS):
        for y in EYE_ROWS:
            px[x, y] = PUPIL
    px[LEFT_EYE_COLS[0], EYE_ROWS[0]] = HIGHLIGHT
    px[RIGHT_EYE_COLS[0], EYE_ROWS[0]] = HIGHLIGHT

    img.save(DIR / "front.png")
    img.resize((img.size[0] * 16, img.size[1] * 16), Image.Resampling.NEAREST) \
       .save(DIR / "front-16x.png")
    print("f2 front touched up; wrote front-16x.png")


if __name__ == "__main__":
    main()
