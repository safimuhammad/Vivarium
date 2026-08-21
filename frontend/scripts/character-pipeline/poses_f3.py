"""Author the 5 pose frames for F3 (auburn-ponytail, freckles, trousers villager).

F3-specific variant of `poses.py` (m1's method) — a `touchup_f3.py`-style
sibling, not an edit to `poses.py`'s m1 numbers. Coordinates come from a
raw-pixel dump of `roster/f3-sprites/front.png` / `side.png` (16x48 / 22x48)
— see `ROSTER_PIPELINE_NOTES.md`.

F3 wears trousers, and unlike both F1 (skirt) and F2 (a 1px trouser-boundary
sliver), the hanging hand (side view, rows 24-32) sits entirely above the
waist/trouser boundary (row 34) with no overlap at all — so `side_reach`
uses a single flat top-color fill, matching m1's original simpler recipe
rather than F1/F2's row-threshold split.

Lesson carried over from F2's first-draft mistake: place the reach arm at
genuine mid-chest height (rows 26-27, well clear of the shoulder/collar
band at rows 19-23), not right under the jaw — a reach drawn too close to
the head reads as a neck lump instead of an outstretched arm.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from derive_frames import drop_torso
from pxutil import contact_sheet

DIR = Path(__file__).parent.parent.parent / "assets/character-claude/roster/f3-sprites"

SKIN = (246, 192, 131, 255)
SKIN_SHADE = (246, 186, 126, 255)   # also the hanging-hand tone
PUPIL = (55, 17, 6, 255)
TOP_MAIN = (138, 138, 84, 255)      # sage top
MOUTH_DARK = (83, 38, 16, 255)      # reused hair-mid tone, doubling as mouth interior

# -- front_blink / front_talk (front.png), from touchup_f3.py's eye geometry --
EYE_COLS = (5, 6, 9, 10)
EYE_TOP_ROWS = (13, 14)         # cleared to skin for the closed-eye look
EYE_LASH_ROW = 15               # redrawn as the closed-lash line
MOUTH_COLS = (7, 8)             # the pre-existing lip-colored columns
MOUTH_OPEN_ROW = 20
MOUTH_DARK_ROW = 21

# -- side_reach (side.png) -- hand sits entirely above the trouser boundary
# (row 34), so a single flat fill (no F1/F2-style row-threshold split) is
# enough — matches m1's original recipe.
ARM_ERASE_ROWS = range(24, 33)
ARM_ERASE_COLS = range(6, 11)
REACH_ROWS = (26, 27)
REACH_SKIN_COLS = range(10, 17)
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
    erase_colors = (SKIN, SKIN_SHADE)
    for y in ARM_ERASE_ROWS:
        for x in ARM_ERASE_COLS:
            if px[x, y] in erase_colors:
                px[x, y] = TOP_MAIN
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
