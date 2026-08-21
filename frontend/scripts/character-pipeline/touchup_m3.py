"""Hand-touch pass for the M3 (shaggy-blond, vest-over-shirt villager) sprites.

M3-specific variant of `touchup_chibi.py` (m1's method). Coordinates come
from an ASCII map of `roster/m3-sprites/front.png` / `back.png` (19x48) —
see `ROSTER_PIPELINE_NOTES.md`.

Two things this touch-up does, in order:

1. **Vest/shirt sleeve restore (front.png + back.png).** M3 is the roster's
   named vest-over-cream-shirt case, and the raw quantize+despeckle DID lose
   the two-tone contrast on one side: the LEFT sleeve cuff survived as clean
   cream pixels, but the mirror-symmetric RIGHT sleeve cuff was fully
   absorbed into vest-brown tones (confirmed against the source reference —
   both sleeves are visually identical there). Fixed by mirroring the
   sprite's own confirmed-good left-sleeve cream footprint onto the right,
   restoring ONLY pixels that are currently a vest-family tone (never skin
   or transparent, so hands and the asymmetric strap/lapel silhouette are
   left untouched). `side.png` shows no cream sleeve sliver at all in either
   raw quantize — checked against the reference, where the visible sliver
   there is 1-2px and mostly occluded by the satchel strap anyway — left
   as-is rather than hand-guessing coordinates with no ASCII-map evidence.
2. **Eyes + smile**, same technique as every other roster character.

The vest's own internal fold-shading (4 close brown tones alternating
pixel-by-pixel) was checked against the source reference, which shows the
same painterly multi-tone fold shading — left as-is, not flattened, since
it is a faithful downsample rather than a merge artifact.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

DIR = Path(__file__).parent.parent.parent / "assets/character-claude/roster/m3-sprites"

SKIN = (252, 198, 132, 255)
SKIN_SHADE = (230, 150, 82, 255)  # neck-shadow tone, doubles as smile-crease
RAW_PUPIL_DARK = (39, 28, 14, 255)
PUPIL = (39, 28, 14, 255)
CREAM = (245, 218, 172, 255)  # shirt-cream, also doubles as eye highlight

# Vest-family tones eligible to be overwritten by the sleeve-restore mirror
# fix. Never includes skin or the darkest outline/pupil tone.
VEST_TONES = {
    (134, 75, 29, 255),
    (124, 65, 26, 255),
    (97, 68, 29, 255),
    (77, 41, 18, 255),
    (109, 91, 44, 255),
}

# Eye geometry, judged from the ASCII map. front.png is 19px wide; true
# center = (19-1)/2 = 9. Cols (6,7)/(11,12) are symmetric about that center.
EYE_ROWS = (11, 12, 13)
LEFT_EYE_COLS = (6, 7)
RIGHT_EYE_COLS = (11, 12)
EYE_CLEAR_COLS = range(4, 15)

# No raw smile/chin-shadow artifact exists (checked at zoom, like M2) —
# hand-authored 2px hint on the last skin row before the collar.
SMILE_ROW = 17
SMILE_COLS = (8, 9)


def restore_sleeve(img: Image.Image) -> int:
    """Mirror the confirmed-good left-sleeve cream footprint onto the right.

    Scans the left half of the torso band for existing CREAM pixels, and for
    each one whose mirror column currently holds a vest-family tone,
    overwrites it with CREAM. Skin and transparent mirror targets are left
    untouched (hands and the asymmetric strap/lapel silhouette must survive
    unchanged). Returns the number of pixels restored, for the visual-loop
    log.

    Mutates `img` in place.
    """
    px = img.load()
    w, _h = img.size
    mirror = lambda x: (w - 1) - x  # noqa: E731
    restored = 0
    cream_left = [(x, y) for y in range(15, 31) for x in range(0, w // 2 + 1) if px[x, y] == CREAM]
    for x, y in cream_left:
        mx = mirror(x)
        if mx == x:
            continue
        if px[mx, y] in VEST_TONES:
            px[mx, y] = CREAM
            restored += 1
    return restored


def main() -> None:
    front = Image.open(DIR / "front.png").convert("RGBA")
    n_front = restore_sleeve(front)

    back = Image.open(DIR / "back.png").convert("RGBA")
    n_back = restore_sleeve(back)

    px = front.load()

    # -- eyes: clear the raw quantized pupil blobs back to skin, then redraw
    #    two clean symmetric pupils with a highlight (shirt-cream doubles as
    #    highlight, matching m1/F1's "reuse an existing light color" rule).
    for y in EYE_ROWS:
        for x in EYE_CLEAR_COLS:
            if px[x, y] == RAW_PUPIL_DARK:
                px[x, y] = SKIN
    for x in (*LEFT_EYE_COLS, *RIGHT_EYE_COLS):
        for y in EYE_ROWS:
            px[x, y] = PUPIL
    px[LEFT_EYE_COLS[0], EYE_ROWS[0]] = CREAM
    px[RIGHT_EYE_COLS[0], EYE_ROWS[0]] = CREAM

    # -- smile: hand-authored 2px shadow-crease hint --
    for x in SMILE_COLS:
        px[x, SMILE_ROW] = SKIN_SHADE

    front.save(DIR / "front.png")
    back.save(DIR / "back.png")
    front.resize((front.size[0] * 16, front.size[1] * 16), Image.Resampling.NEAREST).save(
        DIR / "front-16x.png"
    )
    print(f"m3 sleeve restore: front={n_front}px back={n_back}px")
    print("m3 front/back touched up; wrote front-16x.png")


if __name__ == "__main__":
    main()
