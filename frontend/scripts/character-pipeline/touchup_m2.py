"""Hand-touch pass for the M2 (curly-hair villager) front sprite.

M2-specific variant of `touchup_chibi.py` (m1's method). Coordinates come
from an ASCII map of `roster/m2-sprites/front.png` (17x48) — see
`ROSTER_PIPELINE_NOTES.md` for how these numbers were derived and what
future roster characters need.

M2's raw quantize already separated the eyebrows (row 9) from the pupils
(rows 11-13) into two distinct dark blobs with a clean skin gap between them
— no full-width "one wide hole" clear was needed (matches F1's pipeline
variance, not m1's). The eyebrows read correctly as-is and are left
untouched; only the pupil blobs are cleared and redrawn as clean symmetric
2x3 shapes. Unlike m1/F1, M2's raw quantize left NO smile/chin-shadow
artifact at all (verified via a zoomed crop before writing this script), so
the smile here is hand-authored from scratch (m1's original approach) using
the sprite's own lighter skin tone as a shadow-crease, not narrowed from an
existing block. The satchel strap survived quantization+despeckle cleanly
(verified by zoomed crop of the torso) — no redraw needed, left untouched.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

DIR = Path(__file__).parent.parent.parent / "assets/character-claude/roster/m2-sprites"

SKIN = (181, 96, 36, 255)           # 'e' — main/darker skin tone
SKIN_LIGHT = (187, 105, 46, 255)    # 'f' — lighter skin tone, doubles as eye highlight
RAW_PUPIL_DARK = (36, 16, 5, 255)   # 'g' — the naturally-quantized pupil/eyebrow blob color
PUPIL = (36, 16, 5, 255)            # redraw with the same near-black-brown tone
SKIN_SHADE = (112, 57, 25, 255)     # 'i' — doubles as strap leather / ear shadow

# Eye geometry, judged from the ASCII map (see ROSTER_PIPELINE_NOTES.md).
# front.png is 17px wide; true center = (17-1)/2 = 8. Cols (4,5)/(11,12) are
# symmetric about that center (mirror(4)=12, mirror(5)=11).
EYE_ROWS = (11, 12, 13)
LEFT_EYE_COLS = (4, 5)
RIGHT_EYE_COLS = (11, 12)
EYE_CLEAR_COLS = range(2, 15)   # face-interior band spanning both raw pupil blobs

# No raw smile/chin-shadow artifact exists at any zoom (verified before
# writing this file) — hand-author a 2px hint on one row, m1's own scale.
# M2's two skin tones (SKIN/SKIN_LIGHT) are only ~6-10 units apart per
# channel — a crease drawn with them was invisible even at 36x zoom (logged
# as a visual-loop iteration below), so the crease reuses SKIN_SHADE
# instead, matching the actual contrast m1/F1 relied on for their smiles.
SMILE_ROW = 17
SMILE_COLS = (7, 8)


def main() -> None:
    img = Image.open(DIR / "front.png").convert("RGBA")
    px = img.load()

    # -- eyes: clear the raw quantized pupil blobs back to skin, then redraw
    #    two clean symmetric 2x3 pupils with a top-row highlight (same
    #    technique as touchup_chibi.py's m1 eyes / touchup_f1.py's F1 eyes).
    #    The eyebrows (row 9, same raw color) sit outside EYE_ROWS and are
    #    intentionally left untouched — they already read correctly. --
    for y in EYE_ROWS:
        for x in EYE_CLEAR_COLS:
            if px[x, y] == RAW_PUPIL_DARK:
                px[x, y] = SKIN
    for x in (*LEFT_EYE_COLS, *RIGHT_EYE_COLS):
        for y in EYE_ROWS:
            px[x, y] = PUPIL
    px[LEFT_EYE_COLS[0], EYE_ROWS[0]] = SKIN_LIGHT
    px[RIGHT_EYE_COLS[0], EYE_ROWS[0]] = SKIN_LIGHT

    # -- smile: hand-authored 2px shadow-crease hint (no raw artifact to
    #    narrow) --
    for x in SMILE_COLS:
        px[x, SMILE_ROW] = SKIN_SHADE

    img.save(DIR / "front.png")
    img.resize((img.size[0] * 16, img.size[1] * 16), Image.Resampling.NEAREST) \
       .save(DIR / "front-16x.png")
    print("m2 front touched up; wrote front-16x.png")


if __name__ == "__main__":
    main()
