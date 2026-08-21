"""Hand-touch pass for the M4 (grey-hair, bearded elder villager) front sprite.

M4-specific variant of `touchup_chibi.py` (m1's method). Coordinates come
from an ASCII map of `roster/m4-sprites/front.png` (18x48) — see
`ROSTER_PIPELINE_NOTES.md`.

Two roster-plan concerns were explicitly verified before touching anything:

1. **Beard identity.** The raw quantize+despeckle already renders a clean,
   readable grey beard mass (mustache at the upper lip, full beard along
   the jaw/chin) on BOTH front.png and side.png, confirmed via zoomed crops
   of each. No touch-up was needed to make the beard read — it survives
   quantization intact. Left untouched (this touch-up only reshapes the
   eyes; the beard's raw shape/tones are exactly what quantize produced).
2. **Grey hair vs. bone-grey shirt separation.** Checked numerically (the
   hair family — (128,116,104)/(172,152,129)/(92,83,67) — vs. the shirt
   family — (218,192,150)/(222,198,156)) and visually (a zoomed back.png
   crop, where hair sits directly above the shirt collar): the two clusters
   never merge or bleed into each other anywhere in front/back/side. No
   forced re-clustering was needed.

No smile touch-up: the beard/mustache fully occludes the mouth in the
source reference, and the raw quantize already leaves a small natural
skin-colored gap between mustache and chin-beard (row 16) reading as the
mouth shadow. Hand-authoring an extra crease into that 5px gap was judged
more likely to read as noise than as a smile, so it is left as quantize
produced it.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

DIR = Path(__file__).parent.parent.parent / "assets/character-claude/roster/m4-sprites"

SKIN = (222, 153, 81, 255)
SHIRT = (218, 192, 150, 255)  # doubles as eye highlight (m1/F1 convention)
RAW_PUPIL_DARK = (46, 38, 18, 255)
PUPIL = (46, 38, 18, 255)

# Eye geometry, judged from the ASCII map. front.png is 18px wide; true
# center = (18-1)/2 = 8.5. Cols (5,6)/(11,12) are symmetric about that
# center (mirror(5)=12, mirror(6)=11).
EYE_ROWS = (10, 11, 12)
LEFT_EYE_COLS = (5, 6)
RIGHT_EYE_COLS = (11, 12)
EYE_CLEAR_COLS = range(3, 15)


def main() -> None:
    img = Image.open(DIR / "front.png").convert("RGBA")
    px = img.load()

    # -- eyes: clear the raw quantized pupil blobs back to skin, then redraw
    #    two clean symmetric pupils with a top-row highlight. --
    for y in EYE_ROWS:
        for x in EYE_CLEAR_COLS:
            if px[x, y] == RAW_PUPIL_DARK:
                px[x, y] = SKIN
    for x in (*LEFT_EYE_COLS, *RIGHT_EYE_COLS):
        for y in EYE_ROWS:
            px[x, y] = PUPIL
    px[LEFT_EYE_COLS[0], EYE_ROWS[0]] = SHIRT
    px[RIGHT_EYE_COLS[0], EYE_ROWS[0]] = SHIRT

    img.save(DIR / "front.png")
    img.resize((img.size[0] * 16, img.size[1] * 16), Image.Resampling.NEAREST).save(
        DIR / "front-16x.png"
    )
    print("m4 front touched up; wrote front-16x.png")


if __name__ == "__main__":
    main()
