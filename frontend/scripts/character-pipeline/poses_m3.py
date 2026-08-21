"""Author the 5 pose frames for M3 (shaggy-blond, vest-over-shirt villager).

M3-specific variant of `poses.py` (m1's method) — a `touchup_m3.py`-style
sibling rather than an edit to `poses.py`'s m1 numbers. Coordinates come
from an ASCII map of `roster/m3-sprites/front.png` / `side.png` (18-19x48)
— see `ROSTER_PIPELINE_NOTES.md`.

`side_reach`: M3's hanging hand runs rows 25-30, cols 6-9 in the side view,
entirely within the vest-covered torso band (the vest's hem sits well below
this, per the ASCII map's immediate-neighbor colors at these rows being
vest tones, not shirt-cream or trousers) — a single vest-color fill is
enough, m1/m2-style, no two-tier fill needed.

`side_crouch`/`side_kneel`: m1's literal row numbers were tried unchanged
first per ROSTER_PIPELINE_NOTES.md's guidance — M3's own waist also lands
at row 33/34 (confirmed while judging `hip_frac` for `derive_frames.py`).
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from derive_frames import drop_torso
from pxutil import contact_sheet

DIR = Path(__file__).parent.parent.parent / "assets/character-claude/roster/m3-sprites"

SKIN = (252, 198, 132, 255)
SKIN_SHADE = (230, 150, 82, 255)
PUPIL = (39, 28, 14, 255)
VEST_MAIN = (124, 65, 26, 255)
MOUTH_DARK = (97, 68, 29, 255)

# -- front_blink / front_talk (front.png), from touchup_m3.py's eye geometry --
EYE_COLS = (6, 7, 11, 12)
EYE_TOP_ROWS = (11, 12)
EYE_LASH_ROW = 13
MOUTH_COLS = (8, 9)
MOUTH_OPEN_ROW = 17
MOUTH_DARK_ROW = 18

# -- side_reach (side.png) --
# The hanging hand runs rows 25-30, cols 6-9 — entirely inside the vest
# band (see module docstring); one flat vest fill is enough.
ARM_ERASE_ROWS = range(25, 31)
ARM_ERASE_COLS = range(6, 10)
ERASE_COLORS = (SKIN, SKIN_SHADE)
REACH_ROWS = (21, 22)
REACH_SLEEVE_COLS = (10, 11)
REACH_SKIN_COLS = range(12, 18)
REACH_HAND_COL = 17

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
                px[x, y] = VEST_MAIN
    for y in REACH_ROWS:
        for x in REACH_SLEEVE_COLS:
            px[x, y] = VEST_MAIN
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
