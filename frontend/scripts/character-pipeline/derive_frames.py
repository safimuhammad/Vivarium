"""Derive 4-frame walk strips (contact-A, passing, contact-B, passing) from base sprites.

Usage: python derive_frames.py <sprites_dir> [hip_frac] [step_px] [bob_px]
Reads front.png/back.png/side.png, writes walk-{down,up,side}.png + frames-preview.png.
Cycle convention matches the engine: passing frames ARE the base (idle) pose.
"""

from __future__ import annotations

import sys
from functools import partial
from pathlib import Path

from PIL import Image
from pxutil import contact_sheet


def hip_row(img: Image.Image, hip_frac: float) -> int:
    return int(img.size[1] * hip_frac)


def leg_cols(img: Image.Image, hip: int) -> list[int]:
    """Columns containing any leg-region foreground."""
    px = img.load()
    return [x for x in range(img.size[0]) if any(px[x, y][3] > 0 for y in range(hip, img.size[1]))]


def shift_cols(img: Image.Image, cols: list[int], hip: int, dx: int, dy: int) -> None:
    """Move the leg-region pixels of the given columns by (dx, dy), in place."""
    shift_band(img, cols, hip, img.size[1], dx, dy)


def cols_in_band(img: Image.Image, y0: int, y1: int) -> list[int]:
    """Columns containing any foreground within row band [y0, y1)."""
    px = img.load()
    return [x for x in range(img.size[0]) if any(px[x, y][3] > 0 for y in range(y0, y1))]


def shift_band(img: Image.Image, cols: list[int], y0: int, y1: int, dx: int, dy: int) -> None:
    """Move the foreground pixels of the given columns within row band [y0, y1), in place."""
    px = img.load()
    w, h = img.size
    moved = {(x, y): px[x, y] for x in cols for y in range(y0, y1) if px[x, y][3] > 0}
    for x, y in moved:
        px[x, y] = (0, 0, 0, 0)
    for (x, y), c in moved.items():
        nx, ny = x + dx, y + dy
        if 0 <= nx < w and 0 <= ny < h:
            px[nx, ny] = c


def drop_torso(img: Image.Image, hip: int, bob: int) -> Image.Image:
    """Crouch-into-step: rows above the hip move down by `bob`; feet stay planted."""
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    torso = img.crop((0, 0, img.size[0], hip))
    out.alpha_composite(img)  # legs (and everything) first
    top = Image.new("RGBA", img.size, (0, 0, 0, 0))
    top.paste(torso, (0, bob))
    # clear the original torso band, then lay the dropped torso over the legs
    for y in range(hip):
        for x in range(img.size[0]):
            out.putpixel((x, y), (0, 0, 0, 0))
    out.alpha_composite(top)
    return out


def mirror_legs(img: Image.Image, hip: int) -> Image.Image:
    """Flip only the leg region horizontally (opposite stride for free)."""
    out = img.copy()
    legs = img.crop((0, hip, img.size[0], img.size[1]))
    flipped = legs.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    for y in range(hip, img.size[1]):  # clear then paste keeps alpha honest
        for x in range(img.size[0]):
            out.putpixel((x, y), (0, 0, 0, 0))
    out.alpha_composite(flipped, (0, hip))
    return out


def contact_frontback(base: Image.Image, hip: int, step: int, bob: int) -> Image.Image:
    """Front/back contact pose: one boot lifted |step|px; sign picks which boot."""
    f = base.copy()
    cols = leg_cols(f, hip)
    mid = (cols[0] + cols[-1]) // 2
    side = [x for x in cols if x <= mid] if step > 0 else [x for x in cols if x > mid]
    shift_cols(f, side, hip, 0, -abs(step))
    return drop_torso(f, hip, bob)


def contact_side(base: Image.Image, hip: int, step: int, bob: int) -> Image.Image:
    """Side contact pose: legs split fore/aft by `step`; sign swaps the stride.

    Offsets, never mirroring — a mirrored leg region flips the boot toes
    backwards relative to the facing direction.
    """
    f = base.copy()
    cols = leg_cols(f, hip)
    mid = (cols[0] + cols[-1]) // 2
    shift_cols(f, [x for x in cols if x > mid], hip, step, 0)
    shift_cols(f, [x for x in cols if x <= mid], hip, -step, 0)
    return drop_torso(f, hip, bob)


def contact_side_skirted(
    base: Image.Image, hip: int, step: int, bob: int, boot_row: int, sway: int = 1
) -> Image.Image:
    """Side contact pose for a skirted character: boots-only offset + hem sway.

    `contact_side`'s full-height column shift disconnects a skirt hem from
    the legs below it (the hem sits above `hip` and never moves, so a leg
    shifted `step` columns sideways leaves a visible gap under the fabric —
    the "hem shear artifact" called out in the roster-integration skirt
    rule). This variant shifts only the solid-boot rows (`boot_row..bottom`)
    by the full `step`, and gives the ankle/hem-sliver rows (`hip..boot_row`)
    a much smaller `sway` (same sign as `step`, magnitude fixed) so the
    fabric appears to follow the stride slightly instead of tearing away.

    Args:
        base: Source sprite (side view).
        hip: Row index where the torso/skirt region ends and the leg
            region begins (as in `contact_side`).
        step: Full column offset for the boot region; sign picks the stride.
        bob: Vertical drop applied to the torso for the crouch-into-step look.
        boot_row: Row index where solid boot pixels begin (`boot_row >= hip`).
            Rows in `[hip, boot_row)` are the ankle/hem-sliver band that gets
            `sway` instead of `step`.
        sway: Column offset applied to the ankle/hem-sliver band. Defaults to
            1px, matching the roster-integration skirt-rule fallback.

    Returns:
        The contact-pose frame with boots offset by `step`, the hem sliver
        offset by `sway`, and the torso dropped by `bob`.
    """
    f = base.copy()
    h = f.size[1]

    # Boots: full `step` offset, fore/aft split by the boot band's own midpoint.
    boot_cols = cols_in_band(f, boot_row, h)
    boot_mid = (boot_cols[0] + boot_cols[-1]) // 2 if boot_cols else 0
    shift_band(f, [x for x in boot_cols if x > boot_mid], boot_row, h, step, 0)
    shift_band(f, [x for x in boot_cols if x <= boot_mid], boot_row, h, -step, 0)

    # Ankle/hem-sliver band: split by the SAME boot_mid reference (not its own
    # midpoint) so each half sways toward its matching boot rather than as one
    # uniform block — a uniform sway leaves the backward-shifted boot's gap
    # nearly as large as an unswayed one (step - (-sway) is almost step).
    # Split + signed sway keeps both sides' residual gap to step - sway.
    sway = abs(sway)
    if sway:
        forward_sway, backward_sway = (sway, -sway) if step > 0 else (-sway, sway)
        sliver_cols = cols_in_band(f, hip, boot_row)
        shift_band(f, [x for x in sliver_cols if x > boot_mid], hip, boot_row, forward_sway, 0)
        shift_band(f, [x for x in sliver_cols if x <= boot_mid], hip, boot_row, backward_sway, 0)

    return drop_torso(f, hip, bob)


def build_strip(base: Image.Image, contact_fn, hip_frac: float, step: int, bob: int) -> Image.Image:
    hip = hip_row(base, hip_frac)
    contact_a = contact_fn(base, hip, step, bob)
    contact_b = contact_fn(base, hip, -step, bob)  # opposite stride via sign, not mirror
    frames = [contact_a, base, contact_b, base]  # passing == base == idle
    w, h = base.size
    strip = Image.new("RGBA", (w * 4, h), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        strip.alpha_composite(fr, (i * w, 0))
    return strip


def main() -> None:
    sprites_dir = Path(sys.argv[1])
    hip_frac = float(sys.argv[2]) if len(sys.argv) > 2 else 0.78
    step = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    bob = int(sys.argv[4]) if len(sys.argv) > 4 else 1
    # Optional 5th arg: boot_row. When given, the side-view contact frames
    # use contact_side_skirted (boots-only offset + 1px hem sway) instead of
    # contact_side's full-height column shift — see the skirt rule in
    # docs/superpowers/plans/2026-07-24-roster-integration.md and
    # ROSTER_PIPELINE_NOTES.md. Leave unset for non-skirted characters (m1
    # behavior is unchanged).
    boot_row = int(sys.argv[5]) if len(sys.argv) > 5 else None
    side_contact_fn = (
        partial(contact_side_skirted, boot_row=boot_row) if boot_row is not None else contact_side
    )

    plan = [
        ("front", "down", contact_frontback, step),
        ("back", "up", contact_frontback, step),
        ("side", "side", side_contact_fn, step * 2),
    ]  # profile stride needs the extra px
    strips = []
    for src, out_name, fn, view_step in plan:
        base = Image.open(sprites_dir / f"{src}.png").convert("RGBA")
        strip = build_strip(base, fn, hip_frac, view_step, bob)
        strip.save(sprites_dir / f"walk-{out_name}.png")
        strips.append(strip)
        print(f"walk-{out_name}.png  frame {base.size[0]}x{base.size[1]}")
    contact_sheet(strips, zoom=6).save(sprites_dir / "frames-preview.png")
    print(f"wrote {sprites_dir}/frames-preview.png")


if __name__ == "__main__":
    main()
