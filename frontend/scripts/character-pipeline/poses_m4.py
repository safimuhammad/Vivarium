"""Author the 5 pose frames for M4 (grey-hair, bearded elder villager).

M4-specific variant of `poses.py` (m1's method) — a `touchup_m4.py`-style
sibling rather than an edit to `poses.py`'s m1 numbers. Coordinates come
from an ASCII map of `roster/m4-sprites/front.png` / `side.png` (17-18x48)
— see `ROSTER_PIPELINE_NOTES.md`.

`side_reach`: M4's hanging hand runs rows 25-33, cols 4-8 in the side view,
above the hip transition (~row 34) and with shirt-colored immediate
neighbors at those rows — a single shirt-color fill is enough, matching
m2/m3's pattern (no skirt, no two-tier fill needed). Only skin-colored
pixels are erased, so the belt/holster leather interleaved with the fist
stays put.

`side_crouch`/`side_kneel`: m1's literal row numbers were tried unchanged
first per ROSTER_PIPELINE_NOTES.md's guidance — M4's own waist also lands
at row 33/34 (confirmed while judging `hip_frac` for `derive_frames.py`).

No `front_talk`/`front_blink` mouth changes beyond the eye geometry: like
`touchup_m4.py`, the beard occludes the mouth, so `front_talk` reuses the
same small natural skin gap between mustache and chin-beard rather than
hand-authoring a new mouth shape over the beard.
"""

from __future__ import annotations

from pathlib import Path

from derive_frames import drop_torso
from PIL import Image
from pxutil import contact_sheet

DIR = Path(__file__).parent.parent.parent / "assets/character-claude/roster/m4-sprites"

SKIN = (222, 153, 81, 255)
SKIN_LIGHT = (208, 170, 122, 255)
PUPIL = (46, 38, 18, 255)
SHIRT = (218, 192, 150, 255)
MOUTH_DARK = (101, 56, 16, 255)

# -- front_blink / front_talk (front.png), from touchup_m4.py's eye geometry --
EYE_COLS = (5, 6, 11, 12)
EYE_TOP_ROWS = (10, 11)
EYE_LASH_ROW = 12
# The mouth sits in the small natural skin gap between mustache (row 15)
# and chin-beard (row 17) — cols 6-10, row 16 (see touchup_m4.py docstring).
MOUTH_COLS = (7, 8)
MOUTH_OPEN_ROW = 16
MOUTH_DARK_ROW = 16  # single-row gap; open/dark share the row, split by column

# -- side_reach (side.png) --
# The hanging fist runs rows 25-33, cols 4-8 — above the hip transition
# and shirt-bordered (see module docstring); one flat shirt fill is enough.
ARM_ERASE_ROWS = range(25, 34)
ARM_ERASE_COLS = range(4, 9)
ERASE_COLORS = (SKIN, SKIN_LIGHT)
REACH_ROWS = (20, 21)
REACH_SLEEVE_COLS = (10, 11)
REACH_SKIN_COLS = range(12, 17)
REACH_HAND_COL = 16

# -- side_crouch / side_kneel (side.png) — m1's proportions, unchanged --
CROUCH_HIP = 33
CROUCH_BOB = 3
KNEEL_CROP_ROW = 33
KNEEL_LEGS_H = 8
KNEEL_LEGS_Y = 40
KNEEL_TORSO_Y = 7


def front_blink(base: Image.Image) -> Image.Image:
    f = base.copy()
    px = f.load()
    for x in EYE_COLS:
        for y in EYE_TOP_ROWS:
            px[x, y] = SKIN
        px[x, EYE_LASH_ROW] = PUPIL
    return f


def front_talk(base: Image.Image) -> Image.Image:
    f = base.copy()
    px = f.load()
    px[MOUTH_COLS[0], MOUTH_OPEN_ROW] = PUPIL
    px[MOUTH_COLS[1], MOUTH_DARK_ROW] = MOUTH_DARK
    return f


def side_reach(base: Image.Image) -> Image.Image:
    f = base.copy()
    px = f.load()
    for y in ARM_ERASE_ROWS:
        for x in ARM_ERASE_COLS:
            if px[x, y] in ERASE_COLORS:
                px[x, y] = SHIRT
    for y in REACH_ROWS:
        for x in REACH_SLEEVE_COLS:
            px[x, y] = SHIRT
        for x in REACH_SKIN_COLS:
            px[x, y] = SKIN
        px[REACH_HAND_COL, y] = SKIN_LIGHT
    return f


def side_crouch(base: Image.Image) -> Image.Image:
    return drop_torso(base, CROUCH_HIP, CROUCH_BOB)


def side_kneel(base: Image.Image) -> Image.Image:
    f = Image.new("RGBA", base.size, (0, 0, 0, 0))
    legs = base.crop((0, KNEEL_CROP_ROW, base.size[0], 48))
    legs_low = legs.resize((base.size[0], KNEEL_LEGS_H), Image.Resampling.NEAREST)
    torso = base.crop((0, 0, base.size[0], KNEEL_CROP_ROW))
    f.alpha_composite(legs_low, (0, KNEEL_LEGS_Y))
    f.alpha_composite(torso, (0, KNEEL_TORSO_Y))
    return f


def main() -> None:
    front = Image.open(DIR / "front.png").convert("RGBA")
    side = Image.open(DIR / "side.png").convert("RGBA")
    poses = {
        "pose-blink": front_blink(front),
        "pose-talk": front_talk(front),
        "pose-reach": side_reach(side),
        "pose-crouch": side_crouch(side),
        "pose-kneel": side_kneel(side),
    }
    for name, img in poses.items():
        img.save(DIR / f"{name}.png")
        print(name)
    contact_sheet(list(poses.values()), zoom=8).save(DIR / "poses-preview.png")
    print(f"wrote {DIR}/poses-preview.png")


if __name__ == "__main__":
    main()
