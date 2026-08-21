"""Hand-touch pass for the F3 (auburn-ponytail, freckles) front sprite.

F3-specific variant of `touchup_chibi.py`/`touchup_f1.py`/`touchup_f2.py`.
Coordinates come from a raw-pixel dump of `roster/f3-sprites/front.png`
(16x48) — see `ROSTER_PIPELINE_NOTES.md` for the general method.

Like F1, F3's raw quantize produced two already-separated dark eye blobs
with a clean skin nose-bridge gap — but each raw blob is wider (4px/3px)
and asymmetric between the two sides, so per the roster-integration method
("pick pupil columns symmetric around the sprite's true center, not the raw
blob's own center") both raw blobs are cleared back to skin and replaced
with a fresh, evenly-sized symmetric pair.

F3's palette already has a light skin tone (near-white warm beige), so
— like m1/F1 but unlike F2 — skin itself doubles as the highlight (no need
to invent or borrow a garment color).

The mouth is left untouched: quantize already produced a small, distinct
lip-colored patch (`(201, 100, 46, 255)`, a rare tone that appears nowhere
else in the palette) at a plausible mouth position — verified visually
before leaving it, per the "smile may already exist" rule.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

DIR = Path(__file__).parent.parent.parent / "assets/character-claude/roster/f3-sprites"

SKIN = (246, 192, 131, 255)
PUPIL = (55, 17, 6, 255)  # the near-black tone quantize already used for the eye blobs
HIGHLIGHT = SKIN  # F3's skin is already the lightest tone available

# Raw eye-blob pixels (outside the new pupil columns) to clear back to skin.
RAW_LEFT_BLOB = {(2, 13), (3, 13), (4, 13), (2, 14), (3, 14), (4, 14), (4, 15)}
RAW_RIGHT_BLOB = {(11, 13), (12, 13), (11, 14), (12, 14), (11, 15)}

# New symmetric pupils, centered on the sprite's true center (width-1)/2 = 7.5.
EYE_ROWS = (13, 14, 15)
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
    img.resize((img.size[0] * 16, img.size[1] * 16), Image.Resampling.NEAREST).save(
        DIR / "front-16x.png"
    )
    print("f3 front touched up; wrote front-16x.png")


if __name__ == "__main__":
    main()
