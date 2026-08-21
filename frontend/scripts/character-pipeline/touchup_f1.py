"""Hand-touch pass for the F1 (chestnut-hair villager) front sprite.

F1-specific variant of `touchup_chibi.py` (m1's method). Coordinates come from
an ASCII map of `roster/f1-sprites/front.png` (19x48) — see
`ROSTER_PIPELINE_NOTES.md` for how these numbers were derived and what future
roster characters will need to re-derive per-character.

Unlike m1's raw quantize (one wide eye "hole" needing a full-width clear),
F1's source art already quantized into two distinct dark eye blobs separated
by a skin nose-bridge, and the strap/bag survived quantization+despeckle
cleanly (no scattered-leather noise to erase). So this touch-up only
reshapes the eye blobs into clean symmetric 2x3 pupils with a top highlight;
the mouth-shadow and strap are left as the pipeline produced them (verified
by preview, not assumed).
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

DIR = Path(__file__).parent.parent.parent / "assets/character-claude/roster/f1-sprites"

SKIN = (230, 150, 74, 255)          # 'h'
RAW_EYE_DARK = (37, 18, 6, 255)     # 'i' — the naturally-quantized eye blob color
PUPIL = (37, 18, 6, 255)            # redraw with the same near-black (matches m1's PUPIL tone)
HIGHLIGHT = (234, 189, 129, 255)    # blouse cream doubles as eye highlight (m1's pattern)
SKIN_SHADE = (194, 112, 49, 255)    # 'l' — darker skin tone, doubles as strap/bag leather

# Eye geometry, judged from the ASCII map (see ROSTER_PIPELINE_NOTES.md).
EYE_ROWS = (8, 9, 10)
LEFT_EYE_COLS = (6, 7)
RIGHT_EYE_COLS = (11, 12)
EYE_CLEAR_COLS = range(4, 16)   # face-interior band spanning both raw blobs

# The raw quantize pass left a 3x2 chin-shadow block (row 15-16, cols 8-10)
# that reads as a blob rather than a smile curve. Narrow it to a 2px hint on
# one row, m1-style (m1: px[10,17] / px[11,17] = SKIN_SHADE, one row, 2px).
SMILE_ROW = 15
SMILE_COLS = (9, 10)
SMILE_CLEANUP = ((8, 15), (8, 16), (9, 16), (10, 16))  # revert to skin


def main() -> None:
    img = Image.open(DIR / "front.png").convert("RGBA")
    px = img.load()

    # -- eyes: clear the raw quantized blob back to skin, then redraw two
    #    clean symmetric 2x3 pupils with a top-row highlight (same technique
    #    as touchup_chibi.py's m1 eyes, mirrored for F1's 19px-wide sprite). --
    for y in EYE_ROWS:
        for x in EYE_CLEAR_COLS:
            if px[x, y] == RAW_EYE_DARK:
                px[x, y] = SKIN
    for x in (*LEFT_EYE_COLS, *RIGHT_EYE_COLS):
        for y in EYE_ROWS:
            px[x, y] = PUPIL
    px[LEFT_EYE_COLS[0], EYE_ROWS[0]] = HIGHLIGHT
    px[RIGHT_EYE_COLS[0], EYE_ROWS[0]] = HIGHLIGHT

    # -- smile: narrow the raw chin-shadow block to a 2px curve hint --
    for x, y in SMILE_CLEANUP:
        px[x, y] = SKIN
    for x in SMILE_COLS:
        px[x, SMILE_ROW] = SKIN_SHADE

    img.save(DIR / "front.png")
    img.resize((img.size[0] * 16, img.size[1] * 16), Image.Resampling.NEAREST) \
       .save(DIR / "front-16x.png")
    print("f1 front touched up; wrote front-16x.png")


if __name__ == "__main__":
    main()
