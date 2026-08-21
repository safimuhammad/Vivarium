"""Author the 5 pose frames for F2 (deep-brown-skin, bun, trousers villager).

F2-specific variant of `poses.py` (m1's method) — a `touchup_f2.py`-style
sibling, not an edit to `poses.py`'s m1 numbers. Coordinates come from an
ASCII map + raw-pixel dump of `roster/f2-sprites/front.png` / `side.png`
(16x48 / 18x48) — see `ROSTER_PIPELINE_NOTES.md`.

F2 wears trousers (not a skirt), so unlike F1's `side_reach`, the hanging
hand (rows 26-35) sits almost entirely above the waist/trouser boundary
(row 35, the same hip row used by `derive_frames.py`'s hip_frac=0.73) — only
row 35 itself dips a single pixel into trouser territory. Still split the
erase fill by that same row threshold (matches the general "read the fill
color from the undisturbed sprite's neighbors" method), since a single flat
top-color fill would leave one wrong-colored pixel sitting on the waistband.
"""

from __future__ import annotations

from pathlib import Path

from derive_frames import drop_torso
from PIL import Image
from pxutil import contact_sheet

DIR = Path(__file__).parent.parent.parent / "assets/character-claude/roster/f2-sprites"

SKIN = (168, 98, 44, 255)
SKIN_SHADE = (162, 90, 41, 255)  # also the hanging-hand tone
PUPIL = (18, 18, 18, 255)
TOP_MAIN = (176, 77, 29, 255)  # terracotta top
TROUSER_MAIN = (72, 46, 29, 255)
MOUTH_DARK = (53, 27, 11, 255)  # reused boot/strap-dark tone, doubling as mouth interior

# -- front_blink / front_talk (front.png), from touchup_f2.py's eye geometry --
EYE_COLS = (5, 6, 9, 10)
EYE_TOP_ROWS = (11, 12)  # cleared to skin for the closed-eye look
EYE_LASH_ROW = 13  # redrawn as the closed-lash line
MOUTH_COLS = (7, 8)  # the pre-existing subtle mouth-shade columns (sprite center)
MOUTH_OPEN_ROW = 19
MOUTH_DARK_ROW = 20

# -- side_reach (side.png) --
# The hanging hand runs rows 26-35 (a single row, 35, dips into the trouser
# band that starts at the same row); rows 26-34 sit over the top, so the
# erase fill switches color at LOWER_FILL_FROM_ROW instead of one flat fill.
ARM_ERASE_ROWS = range(26, 36)
ARM_ERASE_COLS = range(5, 11)
LOWER_FILL_FROM_ROW = 35
REACH_ROWS = (23, 24)
REACH_SKIN_COLS = range(12, 17)
REACH_HAND_COL = 16

# -- side_crouch / side_kneel (side.png) — m1's proportions, tried first --
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
    for y in ARM_ERASE_ROWS:
        fill = TROUSER_MAIN if y >= LOWER_FILL_FROM_ROW else TOP_MAIN
        for x in ARM_ERASE_COLS:
            if px[x, y] == SKIN_SHADE:
                px[x, y] = fill
    for y in REACH_ROWS:
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
