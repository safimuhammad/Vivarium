"""Author the 5 pose frames for M2 (curly-hair villager, trousers).

M2-specific variant of `poses.py` (m1's method) — a `touchup_m2.py`-style
sibling rather than an edit to `poses.py`'s m1 numbers. Coordinates come
from an ASCII map of `roster/m2-sprites/front.png` / `side.png` (17x48) —
see `ROSTER_PIPELINE_NOTES.md` for how these were derived.

`side_reach`: M2's hanging hand/fist (gripping the satchel strap near the
hip) is entirely within the tunic-covered torso band in the side view (rows
26-33, above where trousers begin at row 34) — unlike F1's skirt case, a
single-fill erase (tunic slate-blue) is enough; no two-tier fill needed.
Only pixels that are actually skin-colored are erased, so the bag/strap
leather pixels interleaved with the fist stay put and read as the bag
remaining after the hand lifts away.

`side_crouch`/`side_kneel`: m1's literal row numbers (`crouch_hip=33,
crouch_bob=3`; `kneel_crop_row=33, legs_h=8, legs_y=40, torso_y=7`) were
tried unchanged first per ROSTER_PIPELINE_NOTES.md's guidance — M2's own
waist also lands at row 33/34 (confirmed while judging `hip_frac` for
`derive_frames.py`), so no re-derivation was needed.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from derive_frames import drop_torso
from pxutil import contact_sheet

DIR = Path(__file__).parent.parent.parent / "assets/character-claude/roster/m2-sprites"

SKIN = (181, 96, 36, 255)
SKIN_LIGHT = (187, 105, 46, 255)
PUPIL = (36, 16, 5, 255)
SHIRT = (54, 66, 90, 255)
MOUTH_DARK = (112, 57, 25, 255)

# -- front_blink / front_talk (front.png), from touchup_m2.py's eye geometry --
EYE_COLS = (4, 5, 11, 12)
EYE_TOP_ROWS = (11, 12)         # cleared to skin for the closed-eye look
EYE_LASH_ROW = 13               # redrawn as the closed-lash line
MOUTH_COLS = (7, 8)
MOUTH_OPEN_ROW = 17
MOUTH_DARK_ROW = 18

# -- side_reach (side.png) --
# The hanging fist runs rows 26-33, cols 5-11 (bag/strap leather pixels
# interleaved) — entirely inside the tunic band (trousers start row 34), so
# one flat shirt fill is enough (see module docstring).
ARM_ERASE_ROWS = range(26, 34)
ARM_ERASE_COLS = range(5, 12)
ERASE_COLORS = (SKIN, SKIN_LIGHT)
REACH_ROWS = (21, 22)
REACH_SLEEVE_COLS = (9, 10)
REACH_SKIN_COLS = range(11, 17)
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
    for x in MOUTH_COLS:
        px[x, MOUTH_OPEN_ROW] = PUPIL
        px[x, MOUTH_DARK_ROW] = MOUTH_DARK
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
