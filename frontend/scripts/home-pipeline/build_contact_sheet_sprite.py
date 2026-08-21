"""Regenerate hut-kit/contact-sheet.png after the sprite-scale re-derivation.

Reference-only documentation artifact (not read by any test/build). Crops
frames directly from the final atlas PNGs so details.png/yards.png (carried
over byte-identical from H1/H2, untouched by this task) show their real
current content alongside the newly re-derived components.png/ruins.png.
"""

from __future__ import annotations

from PIL import Image, ImageDraw

KIT_DIR = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/assets/character-claude/roster/hut-kit"

HOME_COMPONENT_IDS = [
    "foundation",
    "post",
    "wall-intact",
    "wall-cracked",
    "wall-broken",
    "wall-falling",
    "roof-intact",
    "roof-damaged",
    "roof-falling",
    "door-closed",
    "door-opening-1",
    "door-opening-2",
    "door-opening-3",
    "door-open",
    "door-breached",
    "door-falling",
    "window-cold",
    "window-lit",
    "window-broken",
    "hearth-cold",
    "hearth-lit-1",
    "hearth-lit-2",
    "chimney",
    "dust",
]
HOME_RUIN_IDS = [
    "rubble-full",
    "rubble-full-scavenge",
    "rubble-picked",
    "rubble-picked-scavenge",
    "rubble-bare",
    "rubble-bare-scavenge",
    "collapse-debris",
    "snapshot-sweep-dissolve",
]
YARD_SEMANTIC_FRAMES = [
    "standing-a-base",
    "standing-b-base",
    "warm-overlay",
    "durable-hoarding-overlay",
    "persistent-ruin-base",
]
DETAIL_LABELS = {
    0: "owner",
    1: "stakeholder-1",
    2: "stakeholder-2",
    3: "stakeholder-3",
    4: "stakeholder-4",
    5: "vault",
    6: "hoarding",
    7: "breacher",
    9: "loot",
    10: "claim",
}


def cells(atlas: Image.Image, cell: int, cols: int, count: int) -> list[Image.Image]:
    out = []
    for i in range(count):
        cx, cy = (i % cols) * cell, (i // cols) * cell
        out.append(atlas.crop((cx, cy, cx + cell, cy + cell)))
    return out


def row(imgs: list[Image.Image], names: list[str], cell: int, cols: int) -> Image.Image:
    rows_ = (len(names) - 1) // cols + 1
    sheet = Image.new(
        "RGBA", (cols * (cell + 8) + 8, rows_ * (cell + 22) + 8), (247, 239, 220, 255)
    )
    d = ImageDraw.Draw(sheet)
    for i, (img, name) in enumerate(zip(imgs, names, strict=True)):
        cx, cy = (i % cols) * (cell + 8) + 8, (i // cols) * (cell + 22) + 8
        sheet.alpha_composite(img, (cx, cy))
        d.text((cx, cy + cell + 2), name, fill=(20, 20, 20, 255))
    return sheet


def main() -> None:
    components = Image.open(f"{KIT_DIR}/components.png").convert("RGBA")
    ruins = Image.open(f"{KIT_DIR}/ruins.png").convert("RGBA")
    yards = Image.open(f"{KIT_DIR}/yards.png").convert("RGBA")
    details = Image.open(f"{KIT_DIR}/details.png").convert("RGBA")

    comp_sheet = row(cells(components, 128, 6, 24), HOME_COMPONENT_IDS, 128, 6)
    ruin_sheet = row(cells(ruins, 128, 4, 8), HOME_RUIN_IDS, 128, 4)
    yard_sheet = row(cells(yards, 192, 5, 5), YARD_SEMANTIC_FRAMES, 192, 5)
    detail_names = [f"home-detail-{i}" for i in sorted(DETAIL_LABELS)]
    detail_sheet = row(
        cells(details, 32, 8, 32)[: len(detail_names)], detail_names, 32, len(detail_names)
    )

    section_title_h = 22
    width = max(comp_sheet.width, ruin_sheet.width, yard_sheet.width, detail_sheet.width, 900)
    total_h = (
        section_title_h * 4
        + comp_sheet.height
        + ruin_sheet.height
        + yard_sheet.height
        + detail_sheet.height
        + 40
    )
    sheet = Image.new("RGBA", (width, total_h), (247, 239, 220, 255))
    d = ImageDraw.Draw(sheet)
    y = 6
    d.text(
        (8, y),
        "hut-kit (sprite-scale re-derivation) -- components.png (24 frames)",
        fill=(20, 20, 20, 255),
    )
    y += section_title_h
    sheet.alpha_composite(comp_sheet, (0, y))
    y += comp_sheet.height + 4
    d.text((8, y), "ruins.png (8 frames)", fill=(20, 20, 20, 255))
    y += section_title_h
    sheet.alpha_composite(ruin_sheet, (0, y))
    y += ruin_sheet.height + 4
    d.text((8, y), "yards.png (5 frames, byte-identical carry-over)", fill=(20, 20, 20, 255))
    y += section_title_h
    sheet.alpha_composite(yard_sheet, (0, y))
    y += yard_sheet.height + 4
    d.text(
        (8, y),
        "details.png (10 of 32 slots authored, byte-identical carry-over)",
        fill=(20, 20, 20, 255),
    )
    y += section_title_h
    sheet.alpha_composite(detail_sheet, (0, y))

    sheet.save(f"{KIT_DIR}/contact-sheet.png")
    print("wrote", f"{KIT_DIR}/contact-sheet.png")


if __name__ == "__main__":
    main()
