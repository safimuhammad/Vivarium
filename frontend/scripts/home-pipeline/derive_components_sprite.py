"""Derive hut-kit's components.png (24 slots) from the owner-approved
SPRITE-SCALE reference frontend/assets/character-claude/roster/hut-sprite-states.png
(Safi, 2026-07-24 "SAFI RETURNED" directive: supersedes the prior
detailed-illustration reference; door/window must stay legible; ONE hut
design world-wide).

Keeps the whole-building-frame architecture established by
.superpowers/sdd/hut-fix-report.md (path a): each integrity/lifecycle state
bakes ONE complete building into its wall-* slot; every other component slot
whose content is now baked into that whole frame renders fully transparent so
nothing double-draws or misaligns underneath it (HomeActor's z-order is
[foundation, post, wall, window, hearth, chimney] then [roof, door]).

Mapping (all 4 reference states are used as whole frames):
  state1-construction -> foundation   (only thing visible before the "walls"
                                        build marker fires at 38% progress)
  state2-complete      -> wall-intact  (window glow muted to cold; the warm
                                        pane is re-extracted as a separate
                                        window-lit overlay so it stays a
                                        genuinely additive hearth-warm cue)
  [derived]             -> wall-cracked (mid integrity tier with NO direct
                                        reference: pixel-edited off
                                        wall-intact per Safi's instruction --
                                        crack lines + a few missing roof/wall
                                        chips, door and window still intact)
  state3-breached       -> wall-broken  (jagged wall hole + broken door --
                                        matches the "broken" tier, more
                                        damaged than cracked)
  state4-collapsed      -> wall-falling (mid-collapse transient frame, before
                                        the ruin atlas takes over)

door-open and window-lit remain small, genuinely additive overlays (dark
carved gap / warm glow patch) positioned by the SAME shared per-state ground
anchor so they land correctly on the whole frames.

Run manually via venv/bin/python; not wired into any build.
"""

from __future__ import annotations

import random
import sys

sys.path.insert(0, "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/character-pipeline")

from pxutil import despeckle, mode_pool, snap_palette  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

WORK = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work-sprite"
COMPONENTS_DIR = f"{WORK}/components"
CELL = 128
CREAM = (243, 235, 214)
CREAM_TOL = 34
SCALE = 0.30
CELL_GROUND = (66, 121)  # target (x, y) in the 128x128 cell for each state's ground vertex
TARGET_GROUND = (250, 500)  # must match align_states_sprite.py

# Door/window bboxes in the 128x128 cell, measured by tracing the reference's
# door/window pixels through the SAME transform (crop offset -> scale ->
# ground-anchor paste) used by whole_frame() for state2-complete -- not
# guessed. See the task's mandatory visual-loop iteration notes.
DOOR_BBOX = (26, 63, 62, 120)
WINDOW_BBOX = (79, 75, 98, 94)
WINDOW_COLD_PANE = (54, 64, 80, 255)
WINDOW_WARM_PANE = (255, 196, 86, 255)

HOME_COMPONENT_IDS = [
    "foundation", "post", "wall-intact", "wall-cracked", "wall-broken", "wall-falling",
    "roof-intact", "roof-damaged", "roof-falling", "door-closed", "door-opening-1",
    "door-opening-2", "door-opening-3", "door-open", "door-breached", "door-falling",
    "window-cold", "window-lit", "window-broken", "hearth-cold", "hearth-lit-1",
    "hearth-lit-2", "chimney", "dust",
]

# Slots whose pixel content is baked into one of the whole-building frames
# below; rendered fully transparent so nothing double-draws or misaligns.
EMPTY_SLOTS = [
    "post", "roof-intact", "roof-damaged", "roof-falling", "door-closed",
    "door-opening-1", "door-opening-2", "door-opening-3", "door-breached",
    "door-falling", "window-cold", "window-broken", "hearth-cold",
    "hearth-lit-1", "hearth-lit-2", "chimney",
]


def empty_cell() -> Image.Image:
    return Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))


def key_out_cream(img: Image.Image, cream: tuple[int, int, int] = CREAM, tol: int = CREAM_TOL) -> Image.Image:
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


def trim_smoke(img: Image.Image, keep_below_y: int) -> Image.Image:
    """Shorten state2's chimney-smoke wisp so the SCALE-0.30 whole frame
    doesn't need to clip it awkwardly at the cell's top edge: keep only the
    portion of the wisp closest to the chimney cap (measured on the aligned
    canvas, y in aligned-canvas space).
    """
    out = img.copy()
    px = out.load()
    w, h = out.size
    for y in range(0, keep_below_y):
        for x in range(w):
            px[x, y] = (0, 0, 0, 0)
    return out


def whole_frame(state: str, trim_smoke_below: int | None = None) -> tuple[Image.Image, tuple[int, int]]:
    """Blit one aligned reference state as a single whole-building frame,
    anchored by its own ground vertex at CELL_GROUND. Returns the frame and
    the (x, y) cell position the ground vertex landed at (for overlay reuse).
    """
    img = Image.open(f"{WORK}/{state}-aligned.png").convert("RGBA")
    img = key_out_cream(img)
    if trim_smoke_below is not None:
        img = trim_smoke(img, trim_smoke_below)
    bbox = img.getbbox()
    assert bbox is not None
    left, top, right, bottom = bbox
    cropped = img.crop(bbox)
    ground_col = TARGET_GROUND[0] - left
    ground_row = TARGET_GROUND[1] - top
    cw, ch = cropped.size
    tw, th = round(cw * SCALE), round(ch * SCALE)
    pooled = mode_pool(cropped, th)
    if pooled.width != tw and pooled.width > 0:
        pooled = pooled.resize((tw, th), Image.Resampling.NEAREST)
    pooled = despeckle(pooled, passes=1)
    scaled_ground_col = round(ground_col * SCALE)
    scaled_ground_row = round(ground_row * SCALE)
    paste_x = CELL_GROUND[0] - scaled_ground_col
    paste_y = CELL_GROUND[1] - scaled_ground_row
    canvas = empty_cell()
    canvas.paste(pooled, (paste_x, paste_y), pooled)
    return canvas, (paste_x, paste_y)


def close_holes(img: Image.Image, passes: int = 2) -> Image.Image:
    """Fill single-pixel transparent 'pinholes' left by mode_pool's coverage
    threshold failing on isolated cells near fine linework (found by direct
    zoomed inspection of the door/arch outline -- a real defect, not
    cosmetic): any transparent pixel whose neighborhood is mostly opaque is
    filled with its opaque neighbors' modal color. Leaves real transparent
    regions (background, door archway interior) untouched since those have
    few or no opaque neighbors.
    """
    from collections import Counter

    out = img.copy()
    w, h = out.size
    for _ in range(passes):
        px = out.load()
        edits: list[tuple[int, int, tuple[int, int, int, int]]] = []
        for y in range(h):
            for x in range(w):
                if px[x, y][3] > 0:
                    continue
                ring = [
                    px[nx, ny]
                    for nx in range(x - 1, x + 2)
                    for ny in range(y - 1, y + 2)
                    if (nx, ny) != (x, y) and 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] > 0
                ]
                if len(ring) >= 6:
                    edits.append((x, y, Counter(ring).most_common(1)[0][0]))
        for x, y, c in edits:
            out.putpixel((x, y), c)
    return out


def draw_door(base: Image.Image, bbox: tuple[int, int, int, int]) -> Image.Image:
    """Author a clean, clearly-readable arched wooden door directly at the
    reference-measured DOOR_BBOX: an automatic downsample of the reference's
    fine plank/grate texture to ~36x57px produced illegible dithering (found
    via zoomed inspection), so the door is instead drawn flat -- arch
    outline, wood fill, two plank seams, a handle -- using the reference's
    own silhouette and wood-tone palette rather than its noisy texture.
    """
    out = base.copy()
    d = ImageDraw.Draw(out)
    x0, y0, x1, y1 = bbox
    w = x1 - x0
    outline = (24, 18, 14, 255)
    wood = (118, 78, 42, 255)
    wood_dark = (92, 58, 30, 255)
    arch_h = round(w * 0.62)
    d.pieslice([x0, y0, x1, y0 + arch_h * 2], 180, 360, fill=outline)
    d.rectangle([x0, y0 + arch_h, x1 - 1, y1 - 1], fill=outline)
    inset = 2
    ix0, iy0, ix1, iy1 = x0 + inset, y0 + inset, x1 - inset, y1 - inset
    iw = ix1 - ix0
    iarch_h = round(iw * 0.62)
    d.pieslice([ix0, iy0, ix1, iy0 + iarch_h * 2], 180, 360, fill=wood)
    d.rectangle([ix0, iy0 + iarch_h, ix1 - 1, iy1 - 1], fill=wood)
    for frac in (0.32, 0.68):
        sx = round(ix0 + iw * frac)
        d.line([(sx, iy0 + iarch_h - 2), (sx, iy1 - 2)], fill=wood_dark, width=1)
    hx, hy = round(ix0 + iw * 0.62), round(iy0 + (iy1 - iy0) * 0.55)
    d.ellipse([hx - 2, hy - 2, hx + 2, hy + 2], fill=(30, 26, 22, 255))
    return out


def draw_window(
    base: Image.Image, bbox: tuple[int, int, int, int], pane_color: tuple[int, int, int, int],
) -> Image.Image:
    """Author a clean 2x2-pane window at the reference-measured WINDOW_BBOX
    (same rationale as draw_door: the reference's fine mullion/glow detail
    does not survive the 0.30 downsample legibly). Used for both the cold
    baseline (baked into wall-intact) and the warm window-lit overlay --
    identical geometry, different pane_color, so the two stay pixel-aligned.
    """
    out = base.copy()
    d = ImageDraw.Draw(out)
    x0, y0, x1, y1 = bbox
    frame = (40, 30, 20, 255)
    sill = (70, 55, 38, 255)
    d.rectangle([x0, y0, x1, y1], fill=frame)
    inset = 2
    ix0, iy0, ix1, iy1 = x0 + inset, y0 + inset, x1 - inset, y1 - inset
    d.rectangle([ix0, iy0, ix1, iy1], fill=pane_color)
    midx, midy = (ix0 + ix1) // 2, (iy0 + iy1) // 2
    d.line([(midx, iy0), (midx, iy1)], fill=frame, width=1)
    d.line([(ix0, midy), (ix1, midy)], fill=frame, width=1)
    d.rectangle([x0 - 1, y1 + 1, x1 + 1, y1 + 2], fill=sill)
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
) -> Image.Image:
    out = img.copy()
    px = out.load()
    w, h = out.size
    for y in range(max(0, cy - radius), min(h, cy + radius)):
        for x in range(max(0, cx - radius), min(w, cx + radius)):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            jitter = rng.uniform(-2.0, 2.0)
            if d + jitter < radius and px[x, y][3] > 0:
                px[x, y] = (0, 0, 0, 0)
    return out


def draw_crack_line(img: Image.Image, points: list[tuple[int, int]], width: int = 1) -> Image.Image:
    out = img.copy()
    d = ImageDraw.Draw(out)
    dark = (18, 16, 14, 255)
    d.line(points, fill=dark, width=width, joint="curve")
    return out


def derive_wall_cracked(wall_intact: Image.Image) -> Image.Image:
    """No reference state exists between 'complete' and 'breached' -- per
    task instruction, author this tier by pixel-editing the COMPLETE whole
    frame: add visible crack lines through the roof/wall and knock a few
    stone/turf chips loose, kept clear of the DOOR_BBOX/WINDOW_BBOX so both
    stay legible (this is a light, early damage tier, not yet the jagged
    breach -- door and window are still intact).
    """
    rng = random.Random(20260724)
    out = wall_intact.copy()
    out = draw_crack_line(out, [(16, 68), (21, 80), (16, 94), (20, 104)], width=1)
    out = draw_crack_line(out, [(110, 58), (114, 70), (108, 82)], width=1)
    out = punch_void(out, rng, cx=15, cy=100, radius=4)
    out = punch_void(out, rng, cx=112, cy=50, radius=4)
    out = darken(out, 0.95)
    return out


def derive_door_open(door_bbox: tuple[int, int, int, int]) -> Image.Image:
    """Small additive overlay: the door swung open onto a dark interior gap,
    same arch silhouette/inset as draw_door so it drops in cleanly over the
    closed door baked into wall-intact.
    """
    layer = empty_cell()
    d = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = door_bbox
    w = x1 - x0
    outline = (24, 18, 14, 255)
    dark_interior = (16, 13, 12, 255)
    arch_h = round(w * 0.62)
    d.pieslice([x0, y0, x1, y0 + arch_h * 2], 180, 360, fill=outline)
    d.rectangle([x0, y0 + arch_h, x1 - 1, y1 - 1], fill=outline)
    inset = 2
    ix0, iy0, ix1, iy1 = x0 + inset, y0 + inset, x1 - inset, y1 - inset
    iw = ix1 - ix0
    iarch_h = round(iw * 0.62)
    d.pieslice([ix0, iy0, ix1, iy0 + iarch_h * 2], 180, 360, fill=dark_interior)
    d.rectangle([ix0, iy0 + iarch_h, ix1 - 1, iy1 - 1], fill=dark_interior)
    return layer


def build() -> dict[str, Image.Image]:
    frames: dict[str, Image.Image] = {}
    for slot in EMPTY_SLOTS:
        frames[slot] = empty_cell()

    foundation, _ = whole_frame("state1-construction")
    foundation = close_holes(foundation)
    wall_intact_raw, _ = whole_frame("state2-complete", trim_smoke_below=84)
    wall_intact_raw = close_holes(wall_intact_raw)
    wall_broken, _ = whole_frame("state3-breached")
    wall_broken = close_holes(wall_broken)
    wall_falling, _ = whole_frame("state4-collapsed")
    wall_falling = close_holes(wall_falling)

    # Unify the 4 NATURAL (photo-derived) whole frames onto one shared
    # palette/despeckle pass BEFORE the authored door/window are drawn, so
    # the door/window keep their exact chosen colors (a second global
    # quantization pass was crushing the warm window-lit glow toward the
    # building's earth-tone palette, found by direct zoomed inspection).
    natural = [foundation, wall_intact_raw, wall_broken, wall_falling]
    natural = snap_palette(natural, colors=22)
    natural = [despeckle(img, passes=1) for img in natural]
    foundation, wall_intact_raw, wall_broken, wall_falling = natural

    # The reference's fine door/window detail does not survive the 0.30
    # downsample legibly (found via zoomed inspection -- muddy dithering,
    # not a crisp arch/pane); both are re-authored flat at their
    # reference-measured bboxes directly on top of the whole frame.
    wall_intact = draw_door(wall_intact_raw, DOOR_BBOX)
    wall_intact = draw_window(wall_intact, WINDOW_BBOX, WINDOW_COLD_PANE)
    window_lit = draw_window(empty_cell(), WINDOW_BBOX, WINDOW_WARM_PANE)
    wall_cracked = derive_wall_cracked(wall_intact)
    door_open = derive_door_open(DOOR_BBOX)

    dust = empty_cell()
    rng = random.Random(99)
    dpx = dust.load()
    for _ in range(14):
        x = rng.randint(20, 108)
        y = rng.randint(96, 122)
        shade = rng.choice([(168, 158, 132, 255), (140, 132, 110, 255), (120, 150, 90, 255)])
        dpx[x, y] = shade

    frames["foundation"] = foundation
    frames["wall-intact"] = wall_intact
    frames["wall-cracked"] = wall_cracked
    frames["wall-broken"] = wall_broken
    frames["wall-falling"] = wall_falling
    frames["door-open"] = door_open
    frames["window-lit"] = window_lit
    frames["dust"] = dust

    assert set(frames.keys()) == set(HOME_COMPONENT_IDS), sorted(set(HOME_COMPONENT_IDS) - set(frames.keys()))
    return frames


def main() -> None:
    import os

    frames = build()
    ordered = [frames[name] for name in HOME_COMPONENT_IDS]
    despeckled = list(ordered)
    os.makedirs(COMPONENTS_DIR, exist_ok=True)
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
    sheet.save(f"{WORK}/preview/components-sprite.png")
    print("saved", len(HOME_COMPONENT_IDS), "frames ->", f"{WORK}/components-atlas.png")


if __name__ == "__main__":
    main()
