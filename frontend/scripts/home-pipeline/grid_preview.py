"""Draw a coordinate grid over each cropped state for precise region-picking."""
from PIL import Image, ImageDraw

NAMES = ["state1-construction", "state2-complete", "state3-breached", "state4-collapsed"]
WORK = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work"

for name in NAMES:
    img = Image.open(f"{WORK}/{name}.png").convert("RGBA")
    zoom = 2
    big = img.resize((img.width * zoom, img.height * zoom), Image.Resampling.NEAREST)
    draw = ImageDraw.Draw(big)
    step = 20
    for x in range(0, img.width, step):
        draw.line([(x * zoom, 0), (x * zoom, big.height)], fill=(255, 0, 0, 120), width=1)
        draw.text((x * zoom + 2, 2), str(x), fill=(255, 0, 0, 255))
    for y in range(0, img.height, step):
        draw.line([(0, y * zoom), (big.width, y * zoom)], fill=(0, 120, 255, 120), width=1)
        draw.text((2, y * zoom + 2), str(y), fill=(0, 60, 255, 255))
    big.save(f"{WORK}/preview/{name}-grid.png")
    print(name, img.size, "->", big.size)
