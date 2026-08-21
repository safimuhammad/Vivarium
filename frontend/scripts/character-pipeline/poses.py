"""Author the 5 pose frames for the performance system from the chibi bases.

front-blink, front-talk (open mouth), side-reach, side-crouch, side-kneel.
All frames stay 22x48 so the engine treats them like walk frames.
"""

from __future__ import annotations

from pathlib import Path

from derive_frames import drop_torso
from PIL import Image
from pxutil import contact_sheet

DIR = Path(__file__).parent / "sprites-chibi"

SKIN = (227, 150, 74, 255)
SKIN_LIGHT = (225, 162, 91, 255)
PUPIL = (40, 23, 13, 255)
SHIRT = (248, 225, 182, 255)
MOUTH_DARK = (92, 49, 23, 255)


def front_blink(base: Image.Image) -> Image.Image:
    f = base.copy()
    px = f.load()
    for x in (6, 7, 13, 14):
        for y in (12, 13):
            px[x, y] = SKIN
        px[x, 14] = PUPIL  # closed-lash line
    return f


def front_talk(base: Image.Image) -> Image.Image:
    f = base.copy()
    px = f.load()
    for x in (10, 11):
        px[x, 17] = PUPIL  # open mouth, 2x2
        px[x, 18] = MOUTH_DARK
    return f


def side_reach(base: Image.Image) -> Image.Image:
    f = base.copy()
    px = f.load()
    for y in range(26, 30):  # erase the hanging arm back to shirt
        for x in range(8, 12):
            if px[x, y] in (SKIN, SKIN_LIGHT, (116, 66, 34, 255)):
                px[x, y] = SHIRT
    for y in (24, 25):  # extended arm at shoulder height
        for x in (12, 13):
            px[x, y] = SHIRT  # sleeve
        for x in range(14, 20):
            px[x, y] = SKIN
        px[19, y] = SKIN_LIGHT  # hand tip
    return f


def side_crouch(base: Image.Image) -> Image.Image:
    return drop_torso(base, 33, 3)  # hunch: torso sinks 3px onto the legs


def side_kneel(base: Image.Image) -> Image.Image:
    f = Image.new("RGBA", base.size, (0, 0, 0, 0))
    legs = base.crop((0, 33, base.size[0], 48))  # 15 rows
    legs_low = legs.resize((base.size[0], 8), Image.Resampling.NEAREST)
    torso = base.crop((0, 0, base.size[0], 33))
    f.alpha_composite(legs_low, (0, 40))  # folded legs
    f.alpha_composite(torso, (0, 7))  # body sinks 7px
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
