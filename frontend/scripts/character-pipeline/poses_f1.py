"""Author the 5 pose frames for F1 (chestnut-hair villager, skirt).

F1-specific variant of `poses.py` (m1's method) — a `touchup_f1.py`-style
sibling rather than an edit to `poses.py`'s m1 numbers. Coordinates come from
an ASCII map of `roster/f1-sprites/front.png` / `side.png` (19x48) — see
`ROSTER_PIPELINE_NOTES.md` for how these were derived and what the remaining
five roster characters will need to re-derive for themselves.

One deviation from m1's `side_reach` recipe: F1's hanging hand rests low
enough (row ~32) to cross the blouse/skirt waistline, so erasing it back to
a single "shirt" fill leaves a cream patch sitting in skirt territory. This
version fills the erased band with the blouse cream above row 28 and the
skirt olive at/below it — see `LOWER_FILL_FROM_ROW`.
"""

from __future__ import annotations

from pathlib import Path

from derive_frames import drop_torso
from PIL import Image
from pxutil import contact_sheet

DIR = Path(__file__).parent.parent.parent / "assets/character-claude/roster/f1-sprites"

SKIN = (230, 150, 74, 255)
SKIN_SHADE = (194, 112, 49, 255)  # also the strap/bag leather tone
PUPIL = (37, 18, 6, 255)
BLOUSE = (234, 189, 129, 255)
SKIRT = (108, 90, 36, 255)
MOUTH_DARK = (115, 64, 26, 255)

# -- front_blink / front_talk (front.png), from touchup_f1.py's eye geometry --
EYE_COLS = (6, 7, 11, 12)
EYE_TOP_ROWS = (8, 9)  # cleared to skin for the closed-eye look
EYE_LASH_ROW = 10  # redrawn as the closed-lash line
MOUTH_COLS = (9, 10)
MOUTH_OPEN_ROW = 15
MOUTH_DARK_ROW = 16

# -- side_reach (side.png) --
# The hanging arm/hand runs rows 20-32 (tapers into the skirt at 32); rows
# 20-27 sit over the blouse, 28+ over the skirt waist, so the erase fill
# switches color at LOWER_FILL_FROM_ROW instead of using one flat fill.
ARM_ERASE_ROWS = range(20, 33)
ARM_ERASE_COLS = range(4, 11)
LOWER_FILL_FROM_ROW = 28
REACH_ROWS = (20, 21)
REACH_SLEEVE_COLS = (9, 10)
REACH_SKIN_COLS = range(11, 18)
REACH_HAND_COL = 17

# -- side_crouch / side_kneel (side.png) — same relative proportions as m1 --
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
    for x in MOUTH_COLS:
        px[x, MOUTH_OPEN_ROW] = PUPIL
        px[x, MOUTH_DARK_ROW] = MOUTH_DARK
    return f


def side_reach(base: Image.Image) -> Image.Image:
    f = base.copy()
    px = f.load()
    erase_colors = (SKIN, SKIN_SHADE)
    for y in ARM_ERASE_ROWS:
        fill = SKIRT if y >= LOWER_FILL_FROM_ROW else BLOUSE
        for x in ARM_ERASE_COLS:
            if px[x, y] in erase_colors:
                px[x, y] = fill
    for y in REACH_ROWS:
        for x in REACH_SLEEVE_COLS:
            px[x, y] = BLOUSE
        for x in REACH_SKIN_COLS:
            px[x, y] = SKIN
        px[REACH_HAND_COL, y] = SKIN_SHADE
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
