"""ASCII-map a sprite: one letter per unique RGBA color, printed as a grid.

The touch-up method (`touchup_chibi.py`, `touchup_f1.py`, `poses_f1.py`)
starts by ASCII-mapping the front/side sprite to find exact row/col
coordinates for eyes, mouth, arm, hem, etc. — this is that step.

Usage: venv/bin/python ascii_map.py <sprite.png> [row_start] [row_end]

Caveat: letters are assigned in first-seen order *within one invocation*, so
two separate calls (e.g. rows 0-20 then rows 15-48) do NOT share a letter
mapping — cross-reference by the printed RGB legend, not by letter, when
comparing across calls. Call with the full row range when you need one
consistent map.
"""
from __future__ import annotations

import string
import sys
from pathlib import Path

from PIL import Image


def main() -> None:
    path = Path(sys.argv[1])
    img = Image.open(path).convert("RGBA")
    px = img.load()
    w, h = img.size
    row_start = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    row_end = int(sys.argv[3]) if len(sys.argv) > 3 else h

    colors: dict[tuple[int, int, int, int], str] = {}
    letters = string.ascii_lowercase + string.ascii_uppercase
    # transparent always '.'
    colors[(0, 0, 0, 0)] = "."

    def letter_for(c: tuple[int, int, int, int]) -> str:
        if c not in colors:
            idx = len(colors) - 1  # -1 to skip '.' already used at 0
            colors[c] = letters[idx % len(letters)]
        return colors[c]

    grid = []
    for y in range(row_start, row_end):
        row = []
        for x in range(w):
            row.append(letter_for(px[x, y]))
        grid.append("".join(row))

    # header with column indices (tens then ones)
    tens = "".join(str((x // 10) % 10) if x % 10 == 0 else " " for x in range(w))
    ones = "".join(str(x % 10) for x in range(w))
    print("    " + tens)
    print("    " + ones)
    for i, row in enumerate(grid):
        print(f"{row_start + i:3d} {row}")

    print()
    print("legend:")
    for c, l in colors.items():
        print(f"  {l} = {c}")


if __name__ == "__main__":
    main()
