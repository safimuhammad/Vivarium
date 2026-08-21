"""Shared pixel-pipeline helpers for the character pilot (scratchpad tooling)."""

from __future__ import annotations

from collections import Counter

from PIL import Image

CREAM = (240, 234, 216, 255)


def bg_mask(img: Image.Image, tol: int = 30) -> list[list[bool]]:
    """True where a pixel is close to the corner background color."""
    px = img.load()
    w, h = img.size
    br, bgc, bb = px[0, 0][:3]
    mask = [[False] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y][:3]
            a = px[x, y][3] if len(px[x, y]) == 4 else 255
            if a < 40 or (abs(r - br) <= tol and abs(g - bgc) <= tol and abs(b - bb) <= tol):
                mask[y][x] = True
    return mask


def find_figure_spans(mask: list[list[bool]], min_gap: int = 12) -> list[tuple[int, int]]:
    """Column spans containing foreground, split on wide all-background gaps."""
    h, w = len(mask), len(mask[0])
    col_fg = [any(not mask[y][x] for y in range(h)) for x in range(w)]
    spans: list[tuple[int, int]] = []
    x = 0
    while x < w:
        if col_fg[x]:
            start = x
            gap = 0
            while x < w and gap < min_gap:
                gap = gap + 1 if not col_fg[x] else 0
                x += 1
            spans.append((start, x - gap))
        else:
            x += 1
    return spans


def crop_figure(img: Image.Image, span: tuple[int, int], tol: int = 30) -> Image.Image:
    """Crop one figure span to its tight foreground bounding box."""
    sub = img.crop((span[0], 0, span[1], img.size[1]))
    mask = bg_mask(sub, tol)
    h, w = len(mask), len(mask[0])
    rows = [y for y in range(h) if any(not mask[y][x] for x in range(w))]
    cols = [x for x in range(w) if any(not mask[y][x] for y in range(h))]
    return sub.crop((min(cols), min(rows), max(cols) + 1, max(rows) + 1))


def mode_pool(src: Image.Image, target_h: int, tol: int = 30, cover: float = 0.42) -> Image.Image:
    """Downscale to a true pixel grid via per-cell dominant color; background -> alpha 0."""
    src = src.convert("RGBA")
    mask = bg_mask(src, tol)
    sw, sh = src.size
    scale = target_h / sh
    tw = max(1, round(sw * scale))
    out = Image.new("RGBA", (tw, target_h), (0, 0, 0, 0))
    spx, opx = src.load(), out.load()
    for oy in range(target_h):
        y0, y1 = int(oy / scale), max(int(oy / scale) + 1, int((oy + 1) / scale))
        for ox in range(tw):
            x0, x1 = int(ox / scale), max(int(ox / scale) + 1, int((ox + 1) / scale))
            colors: Counter[tuple[int, int, int]] = Counter()
            total = 0
            for sy in range(y0, min(y1, sh)):
                for sx in range(x0, min(x1, sw)):
                    total += 1
                    if not mask[sy][sx]:
                        r, g, b = spx[sx, sy][:3]
                        colors[(r // 6 * 6, g // 6 * 6, b // 6 * 6)] += 1
            if total and colors and (sum(colors.values()) / total) >= cover:
                r, g, b = colors.most_common(1)[0][0]
                opx[ox, oy] = (r, g, b, 255)
    return out


def snap_palette(imgs: list[Image.Image], colors: int = 14) -> list[Image.Image]:
    """Remap all sprites onto one shared median-cut palette (preserving alpha)."""
    opaque = [p[:3] for im in imgs for p in im.getdata() if p[3] > 0]
    strip = Image.new("RGB", (len(opaque), 1))
    strip.putdata(opaque)
    pal_img = strip.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)
    pal = pal_img.getpalette()[: colors * 3]
    pal_colors = [tuple(pal[i : i + 3]) for i in range(0, len(pal), 3)]

    def nearest(c: tuple[int, int, int]) -> tuple[int, int, int]:
        return min(pal_colors, key=lambda p: sum((a - b) ** 2 for a, b in zip(p, c, strict=True)))

    out = []
    for im in imgs:
        new = Image.new("RGBA", im.size, (0, 0, 0, 0))
        new.putdata([(*nearest(p[:3]), 255) if p[3] > 0 else (0, 0, 0, 0) for p in im.getdata()])
        out.append(new)
    return out


def despeckle(img: Image.Image, passes: int = 2) -> Image.Image:
    """Replace isolated pixels with their 8-neighborhood's majority color.

    A pixel is a speckle when no 4-neighbor shares its exact color. Run after
    snap_palette so colors compare exactly.
    """
    out = img.copy()
    w, h = out.size
    for _ in range(passes):
        px = out.load()
        edits: list[tuple[int, int, tuple[int, int, int, int]]] = []
        for y in range(h):
            for x in range(w):
                if px[x, y][3] == 0:
                    continue
                me = px[x, y]
                four = [
                    px[nx, ny]
                    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
                    if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] > 0
                ]
                if any(n == me for n in four):
                    continue
                ring = [
                    px[nx, ny]
                    for nx in range(x - 1, x + 2)
                    for ny in range(y - 1, y + 2)
                    if (nx, ny) != (x, y) and 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] > 0
                ]
                if ring:
                    edits.append((x, y, Counter(ring).most_common(1)[0][0]))
        for x, y, c in edits:
            out.putpixel((x, y), c)
    return out


def contact_sheet(imgs: list[Image.Image], zoom: int = 8, pad: int = 8) -> Image.Image:
    """Zoomed side-by-side preview on cream, for visual verification."""
    w = sum(im.size[0] * zoom + pad for im in imgs) + pad
    h = max(im.size[1] for im in imgs) * zoom + 2 * pad
    sheet = Image.new("RGBA", (w, h), CREAM)
    x = pad
    for im in imgs:
        big = im.resize((im.size[0] * zoom, im.size[1] * zoom), Image.Resampling.NEAREST)
        sheet.alpha_composite(big, (x, h - pad - big.size[1]))
        x += big.size[0] + pad
    return sheet
