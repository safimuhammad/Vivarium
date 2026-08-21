from PIL import Image, ImageDraw

WORK = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work"
NAMES = ["state1-construction", "state2-complete", "state3-breached", "state4-collapsed"]
for name in NAMES:
    img = Image.open(f"{WORK}/{name}-aligned.png").convert("RGBA")
    bg = Image.new("RGBA", img.size, (247, 239, 220, 255))
    bg.alpha_composite(img, (0, 0))
    zoom = 1.5
    big = bg.resize((int(bg.width * zoom), int(bg.height * zoom)), Image.Resampling.NEAREST)
    d = ImageDraw.Draw(big)
    step = 20
    for x in range(0, bg.width, step):
        d.line([(x * zoom, 0), (x * zoom, big.height)], fill=(255, 0, 0, 110))
        d.text((x * zoom + 1, 1), str(x), fill=(200, 0, 0, 255))
    for y in range(0, bg.height, step):
        d.line([(0, y * zoom), (big.width, y * zoom)], fill=(0, 90, 255, 110))
        d.text((1, y * zoom + 1), str(y), fill=(0, 40, 200, 255))
    big.save(f"{WORK}/preview/{name}-aligned-grid.png")
    print(name, big.size)
