"""Overlay the aligned states (staggered, semi-transparent) to eyeball alignment."""

from PIL import Image, ImageDraw

WORK = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work"
NAMES = ["state1-construction", "state2-complete", "state3-breached", "state4-collapsed"]

canvas = Image.new("RGBA", (420, 460), (247, 239, 220, 255))
draw = ImageDraw.Draw(canvas)
# ground crosshair
draw.line([(210, 0), (210, 460)], fill=(255, 0, 0, 180))
draw.line([(0, 400), (420, 400)], fill=(255, 0, 0, 180))

# side by side grid of the 4 aligned, each at 45% opacity stacked to compare, plus separate row
strip = Image.new("RGBA", (420 * 4, 460), (247, 239, 220, 255))
for i, name in enumerate(NAMES):
    img = Image.open(f"{WORK}/{name}-aligned.png").convert("RGBA")
    tile = Image.new("RGBA", (420, 460), (247, 239, 220, 255))
    tile.alpha_composite(img, (0, 0))
    d = ImageDraw.Draw(tile)
    d.line([(210, 0), (210, 460)], fill=(255, 0, 0, 160))
    d.line([(0, 400), (420, 400)], fill=(255, 0, 0, 160))
    strip.alpha_composite(tile, (i * 420, 0))
    canvas.alpha_composite(img, (0, 0))

strip.save(f"{WORK}/preview/aligned-strip.png")
canvas.save(f"{WORK}/preview/aligned-overlay.png")
print("saved")
