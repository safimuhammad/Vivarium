"""Retint M4's hair-crown highlight pixels off of the shirt-main color.

M4's `palette-sources.json` (`sourcePalette.top[0]`, role `shirt-main`,
`(218,192,150)`) documented a known exact-value color share: that same RGB
also paints a handful of hair-crown highlight pixels at the very top of the
head, on top of its much larger legitimate use as the shirt's dominant fill.
Because `beingPalette.ts` remaps garment colors by exact RGB match across
the *whole* packed atlas frame, every palette-variant pick would have also
recolored those few hair pixels along with the shirt — a real (if tiny)
identity leak, not just a documentation caveat. Fixed at the source per the
locked contract: retint the hair-crown occurrences to a new, hair-adjacent
RGB that is *not* a member of any remap table's `from` list, so it always
renders as a fixed highlight regardless of which garment variant a given
being resolves to.

Bounding region: verified by a full-file pixel scan across all 8 packed
source files (`walk-{down,up,side}.png`, `pose-{blink,talk,reach,crouch,
kneel}.png`) that shirt-main occurrences split into two disjoint y-bands
with a clean 4-row gap between them and zero occurrences in the gap:

  - y <= 12: hair-crown occurrences only (2-6px per frame instance, 73px
    total across all 8 files/17 frame instances).
  - y >= 17: shirt occurrences only (1273px total; the shirt's actual,
    legitimate, large-area fill).

`HAIR_CROWN_MAX_Y = 12` is used as the retint boundary — 4 rows of margin
below the last observed hair-crown hit (y=11) and 4 rows above the first
observed shirt hit (y=17), so no legitimate shirt pixel can ever be
touched. The script asserts this after every file it touches (every
changed pixel must fall at y <= HAIR_CROWN_MAX_Y) rather than trusting the
bound blindly.

Run: `python3 frontend/scripts/character-pipeline/retint_m4_hair.py`
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

DIR = Path(__file__).parent.parent.parent / "assets/character-claude/roster/m4-sprites"

PACKED_FILES = (
    "walk-down.png",
    "walk-up.png",
    "walk-side.png",
    "pose-blink.png",
    "pose-talk.png",
    "pose-reach.png",
    "pose-crouch.png",
    "pose-kneel.png",
)

SHIRT_MAIN = (218, 192, 150, 255)
HAIR_CROWN_RETINT = (217, 193, 152, 255)
HAIR_CROWN_MAX_Y = 12


def retint_file(path: Path) -> int:
    """Retint one packed source file's hair-crown occurrences in place.

    Args:
        path: Absolute path to the source PNG to mutate.

    Returns:
        The number of pixels changed.

    Raises:
        AssertionError: If any changed pixel falls outside the verified
            hair-crown bounding region (`y <= HAIR_CROWN_MAX_Y`) — i.e. if
            this would have touched a real shirt pixel.
    """
    img = Image.open(path).convert("RGBA")
    px = img.load()
    w, h = img.size
    changed: list[tuple[int, int]] = []
    for y in range(min(h, HAIR_CROWN_MAX_Y + 1)):
        for x in range(w):
            if px[x, y] == SHIRT_MAIN:
                px[x, y] = HAIR_CROWN_RETINT
                changed.append((x, y))

    for _x, y in changed:
        assert y <= HAIR_CROWN_MAX_Y, (
            f"{path.name}: retint touched y={y}, outside the verified hair-crown bound "
            f"({HAIR_CROWN_MAX_Y}) — would have recolored a shirt pixel."
        )

    if changed:
        img.save(path)
    return len(changed)


def main() -> None:
    total = 0
    for filename in PACKED_FILES:
        path = DIR / filename
        count = retint_file(path)
        total += count
        print(f"{filename}: retinted {count} hair-crown pixel(s)")
    print(
        f"m4 hair-crown retint complete: {total} pixel(s) changed across {len(PACKED_FILES)} files"
    )


if __name__ == "__main__":
    main()
