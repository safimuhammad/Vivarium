"""H2-hut-fix: replace hut-kit's fragment-cropped components.png with whole-
building frames.

ROOT CAUSE (see .superpowers/sdd/hut-fix-report.md for the full diagnosis):
H1 derived components.png by cropping sub-regions (wall, post, roof, door...)
out of the finished house-b-states.png reference and pasting each into its
own 128x128 cell at a shared affine transform. That works for the OTHER 5
kits because their component art is purpose-authored as solid, mostly-opaque
geometric slabs sized to fully cover whatever draws underneath them in
HomeActor's z-order (post -> wall -> window -> hearth -> chimney, then roof
-> door). H1's crops are the opposite: irregular, mostly-transparent cutouts
of a single finished illustration (holes were literally punched out for the
door/window/foundation regions). When HomeActor stacks them at runtime, the
sparse wall-intact frame does not cover the oversized post scaffold beneath
it, producing the reported "pile of overlapping fragments".

FIX (path a, no HomeActor.ts / productionManifest.ts changes): keep the
existing 24-slot component contract and HomeActor's generic ID-selection
logic exactly as-is. Re-author the CONTENT of each slot so that one slot per
integrity/lifecycle state (wall-intact / wall-cracked / wall-broken /
wall-falling) holds a single whole-building frame blitted from the aligned
reference states (mirroring how the already-correct ruins.png works: one
whole rubble frame per ruin id). Companion slots that would otherwise draw
duplicate/misaligned content on top (post, roof-*, door-closed/-breached/
-falling/-opening-*, window-cold/-broken, hearth-*, chimney) are emptied to
fully transparent 128x128 canvases, since their content is already baked
into the whole frame. door-open and window-lit are kept as small, genuinely
additive overlays (H1's originals, verified aligned against the new whole
frames) so the door-open and hearth-warm physics-visual states seen live in
H2 still read visibly.

Run manually via venv/bin/python; not wired into any build.
"""

from __future__ import annotations

import random
import sys

sys.path.insert(0, "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/character-pipeline")

from pxutil import despeckle, mode_pool, snap_palette  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

WORK = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work"
COMPONENTS_DIR = f"{WORK}/components"
CELL = 128
SCALE = 0.30
OFFSET_X = 13
OFFSET_Y = 2
CREAM = (247, 241, 223)
CREAM_TOL = 30

HOME_COMPONENT_IDS = [
    "foundation", "post", "wall-intact", "wall-cracked", "wall-broken", "wall-falling",
    "roof-intact", "roof-damaged", "roof-falling", "door-closed", "door-opening-1",
    "door-opening-2", "door-opening-3", "door-open", "door-breached", "door-falling",
    "window-cold", "window-lit", "window-broken", "hearth-cold", "hearth-lit-1",
    "hearth-lit-2", "chimney", "dust",
]

# Slots whose PIXEL CONTENT is now baked into one of the whole-building frames
# below and must therefore render as fully empty so nothing double-draws or
# misaligns on top of it.
EMPTY_SLOTS = [
    "post", "roof-intact", "roof-damaged", "roof-falling", "door-closed",
    "door-opening-1", "door-opening-2", "door-opening-3", "door-breached",
    "door-falling", "window-cold", "window-broken", "hearth-cold",
    "hearth-lit-1", "hearth-lit-2", "chimney",
]

# Slots whose existing H1-derived content is small, genuinely additive, and
# already positioned via the SAME shared affine transform as the new whole
# frames -- verified by direct composite in the investigation, kept as-is.
REUSED_SLOTS = ["foundation", "door-open", "window-lit", "dust"]


def empty_cell() -> Image.Image:
    return Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))


def key_out_cream(img: Image.Image, cream: tuple[int, int, int] = CREAM, tol: int = CREAM_TOL) -> Image.Image:
    """Alpha-punch the reference's opaque cream matte (align_states.py only
    trims the OUTER margin to transparent; interior background pixels within
    each state's own bounding box stay fully opaque cream). Without this, a
    whole-frame blit shows as a solid cream card instead of a masked figure.
    """
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    opx = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if abs(r - cream[0]) <= tol and abs(g - cream[1]) <= tol and abs(b - cream[2]) <= tol:
                continue
            opx[x, y] = (r, g, b, a)
    return out


def whole_frame(state: str) -> Image.Image:
    """Blit one aligned reference state as a single whole-building frame,
    using the SAME shared affine transform H1 already validated for door-open
    / window-lit / foundation (SCALE=0.30, OFFSET=(13,2)), so those reused
    small overlays land correctly on top of this frame without re-deriving
    them.
    """
    img = Image.open(f"{WORK}/{state}-aligned.png").convert("RGBA")
    img = key_out_cream(img)
    w, h = img.size
    tw, th = round(w * SCALE), round(h * SCALE)
    pooled = mode_pool(img, th)
    if pooled.width != tw and pooled.width > 0:
        pooled = pooled.resize((tw, th), Image.Resampling.NEAREST)
    pooled = despeckle(pooled, passes=1)
    canvas = empty_cell()
    canvas.paste(pooled, (OFFSET_X, OFFSET_Y), pooled)
    return canvas


def mute_window_glow(img: Image.Image) -> Image.Image:
    """The reference's "complete" state always bakes in a lit/warm window +
    chimney smoke. HomeActor's contract wants window-lit to be a genuinely
    additive overlay (only shown when hearth is warm), so the baseline whole
    frame must show the window unlit/cold by default. Neutralizes the bright
    glow panes in the known window region (measured on the transformed
    frame) to a flat cold-glass tone; the pre-existing window-lit overlay
    frame restores the warm look on top when needed.
    """
    out = img.copy()
    px = out.load()
    cold_pane = (58, 66, 78, 255)
    for y in range(70, 94):
        for x in range(82, 106):
            r, g, b, a = px[x, y]
            if a > 0 and r > 150 and r > b + 30:
                px[x, y] = cold_pane
    return out


def darken(img: Image.Image, factor: float) -> Image.Image:
    out = img.copy()
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (int(r * factor), int(g * factor), int(b * factor), a)
    return out


def punch_void(
    img: Image.Image, rng: random.Random, cx: int, cy: int, radius: int,
    void_color: tuple[int, int, int, int] = (0, 0, 0, 0),
) -> Image.Image:
    out = img.copy()
    px = out.load()
    w, h = out.size
    for y in range(max(0, cy - radius), min(h, cy + radius)):
        for x in range(max(0, cx - radius), min(w, cx + radius)):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            jitter = rng.uniform(-2.5, 2.5)
            if d + jitter < radius and px[x, y][3] > 0:
                px[x, y] = void_color
    return out


def derive_wall_broken(wall_cracked: Image.Image) -> Image.Image:
    """Author a "more damaged than cracked, less than collapsed" whole frame
    (no reference state exists between state3-breached and state4-collapsed
    while still "standing"): darken state3's whole frame and punch two extra
    wall voids, matching H1's own wall-broken damage vocabulary but applied
    to the whole silhouette instead of an isolated fragment.
    """
    rng = random.Random(20260724)
    out = darken(wall_cracked, 0.88)
    out = punch_void(out, rng, cx=30, cy=98, radius=9)
    out = punch_void(out, rng, cx=108, cy=95, radius=8)
    return out


def build() -> dict[str, Image.Image]:
    frames: dict[str, Image.Image] = {}

    for slot in EMPTY_SLOTS:
        frames[slot] = empty_cell()
    for slot in REUSED_SLOTS:
        frames[slot] = Image.open(f"{COMPONENTS_DIR}/{slot}.png").convert("RGBA")

    wall_intact = mute_window_glow(whole_frame("state2-complete"))
    wall_cracked = whole_frame("state3-breached")
    wall_broken = derive_wall_broken(wall_cracked)
    wall_falling = whole_frame("state4-collapsed")

    frames["wall-intact"] = wall_intact
    frames["wall-cracked"] = wall_cracked
    frames["wall-broken"] = wall_broken
    frames["wall-falling"] = wall_falling

    assert set(frames.keys()) == set(HOME_COMPONENT_IDS), sorted(set(HOME_COMPONENT_IDS) - set(frames.keys()))
    return frames


def main() -> None:
    import os

    frames = build()
    ordered = [frames[name] for name in HOME_COMPONENT_IDS]
    snapped = snap_palette(ordered, colors=22)
    despeckled = [despeckle(img, passes=1) for img in snapped]
    for name, img in zip(HOME_COMPONENT_IDS, despeckled, strict=True):
        img.save(f"{COMPONENTS_DIR}/{name}.png")

    cols, rows = 6, 4
    atlas = Image.new("RGBA", (cols * CELL, rows * CELL), (0, 0, 0, 0))
    for i, name in enumerate(HOME_COMPONENT_IDS):
        cx, cy = (i % cols) * CELL, (i // cols) * CELL
        atlas.alpha_composite(despeckled[i], (cx, cy))
    atlas.save(f"{WORK}/components-atlas.png")

    os.makedirs(f"{WORK}/preview", exist_ok=True)
    sheet = Image.new("RGBA", (cols * (CELL + 6) + 6, rows * (CELL + 20) + 6), (247, 239, 220, 255))
    d = ImageDraw.Draw(sheet)
    for i, name in enumerate(HOME_COMPONENT_IDS):
        cx, cy = (i % cols) * (CELL + 6) + 6, (i // cols) * (CELL + 20) + 6
        sheet.alpha_composite(despeckled[i], (cx, cy))
        d.text((cx, cy + CELL + 2), name, fill=(20, 20, 20, 255))
    sheet.save(f"{WORK}/preview/components-whole.png")
    print("saved", len(HOME_COMPONENT_IDS), "frames ->", f"{WORK}/components-atlas.png")


if __name__ == "__main__":
    main()
