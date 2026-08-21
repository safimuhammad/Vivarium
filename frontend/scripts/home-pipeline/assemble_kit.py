"""Assemble the final hut-kit output: atlas PNGs, draft pack.json, contact sheet.

Writes to frontend/assets/character-claude/roster/hut-kit/ (NOT src/assets --
engine registration is H2). Mirrors the existing production kit pack.json
schema (schema, kit, metadataBytes, atlases[], yardGeometry, yardVariants) so
H2 can wire this in with minimal reshaping.
"""

from __future__ import annotations

import hashlib
import json

from PIL import Image, ImageDraw

WORK = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/scripts/home-pipeline/work"
KIT_DIR = "/Users/muhammadsafi/Desktop/software-dev/simulation/frontend/assets/character-claude/roster/hut-kit"

HOME_COMPONENT_IDS = [
    "foundation", "post", "wall-intact", "wall-cracked", "wall-broken", "wall-falling",
    "roof-intact", "roof-damaged", "roof-falling", "door-closed", "door-opening-1",
    "door-opening-2", "door-opening-3", "door-open", "door-breached", "door-falling",
    "window-cold", "window-lit", "window-broken", "hearth-cold", "hearth-lit-1",
    "hearth-lit-2", "chimney", "dust",
]
HOME_RUIN_IDS = [
    "rubble-full", "rubble-full-scavenge", "rubble-picked", "rubble-picked-scavenge",
    "rubble-bare", "rubble-bare-scavenge", "collapse-debris", "snapshot-sweep-dissolve",
]
YARD_SEMANTIC_FRAMES = [
    "standing-a-base", "standing-b-base", "warm-overlay", "durable-hoarding-overlay", "persistent-ruin-base",
]
DETAIL_LABELS = {
    0: "owner", 1: "stakeholder-1", 2: "stakeholder-2", 3: "stakeholder-3", 4: "stakeholder-4",
    5: "vault", 6: "hoarding", 7: "breacher", 9: "loot", 10: "claim",
}


def sha256_of(path: str) -> str:
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def atlas_descriptor(atlas_id: str, filename: str, group: str, cw: int, ch: int, cols: int, rows: int) -> dict:
    path = f"{KIT_DIR}/{filename}"
    img = Image.open(path)
    w, h = img.size
    compressed = __import__("os").path.getsize(path)
    return {
        "id": atlas_id,
        "path": f"homes/hut-kit/{filename}",
        "group": group,
        "regionKit": "hut-kit",
        "width": w,
        "height": h,
        "cellWidth": cw,
        "cellHeight": ch,
        "columns": cols,
        "rows": rows,
        "compressedBytes": compressed,
        "decodedBytes": w * h * 4,
        "sha256": sha256_of(path),
    }


def main() -> None:
    import os

    os.makedirs(KIT_DIR, exist_ok=True)

    # write final atlas PNGs (optimized) into the kit dir
    Image.open(f"{WORK}/components-atlas.png").convert("RGBA").save(f"{KIT_DIR}/components.png", optimize=True)
    Image.open(f"{WORK}/ruins-atlas.png").convert("RGBA").save(f"{KIT_DIR}/ruins.png", optimize=True)
    Image.open(f"{WORK}/yards-atlas.png").convert("RGBA").save(f"{KIT_DIR}/yards.png", optimize=True)
    Image.open(f"{WORK}/details-atlas.png").convert("RGBA").save(f"{KIT_DIR}/details.png", optimize=True)

    atlases = [
        atlas_descriptor("hut-kit-home-components", "components.png", "home", 128, 128, 6, 4),
        atlas_descriptor("hut-kit-home-details", "details.png", "home", 32, 32, 8, 4),
        atlas_descriptor("hut-kit-home-ruins", "ruins.png", "home", 128, 128, 4, 2),
        atlas_descriptor("hut-kit-home-yards", "yards.png", "home", 192, 160, 5, 1),
    ]

    yard_variants = []
    for i, name in enumerate(YARD_SEMANTIC_FRAMES):
        frame_path = f"{WORK}/yards/{name}.png"
        yard_variants.append([i, sha256_of(frame_path)])

    pack = {
        "schema": 1,
        "kit": "hut-kit",
        "draft": True,
        "draftNote": (
            "H1 output: owner-locked stone+turf-roof hut, derived from "
            "house-b-states.png. Not wired into productionManifest.ts yet "
            "(engine registration is H2). geometryHashes/doorClearance/"
            "logicalBounds here are provisional pending H2 reconciliation."
        ),
        "sourceReference": "frontend/assets/character-claude/roster/house-b-states.png",
        "metadataBytes": 0,
        "atlases": atlases,
        "yardGeometry": [96, 112, 80, 32],
        "yardVariants": yard_variants,
        "componentIds": HOME_COMPONENT_IDS,
        "ruinIds": HOME_RUIN_IDS,
        "detailSlotsAuthored": DETAIL_LABELS,
    }
    metadata_bytes = len(json.dumps(pack).encode("utf-8")) + 1
    pack["metadataBytes"] = metadata_bytes
    with open(f"{KIT_DIR}/pack.json", "w") as f:
        json.dump(pack, f, indent=2)
        f.write("\n")

    build_contact_sheet()
    print("kit written to", KIT_DIR)


def build_contact_sheet() -> None:
    comp_dir = f"{WORK}/components"
    ruin_dir = f"{WORK}/ruins"
    yard_dir = f"{WORK}/yards"
    detail_dir = f"{WORK}/details"

    def row(names: list[str], srcdir: str, cell: int, cols: int) -> Image.Image:
        rows_ = (len(names) - 1) // cols + 1
        sheet = Image.new("RGBA", (cols * (cell + 8) + 8, rows_ * (cell + 22) + 8), (247, 239, 220, 255))
        d = ImageDraw.Draw(sheet)
        for i, name in enumerate(names):
            img = Image.open(f"{srcdir}/{name}.png").convert("RGBA")
            cx, cy = (i % cols) * (cell + 8) + 8, (i // cols) * (cell + 22) + 8
            sheet.alpha_composite(img, (cx, cy))
            d.text((cx, cy + cell + 2), name, fill=(20, 20, 20, 255))
        return sheet

    section_title_h = 22
    comp_sheet = row(HOME_COMPONENT_IDS, comp_dir, 128, 6)
    ruin_sheet = row(HOME_RUIN_IDS, ruin_dir, 128, 4)
    yard_sheet = row(YARD_SEMANTIC_FRAMES, yard_dir, 192, 5)
    detail_names = [f"home-detail-{i}" for i in sorted(DETAIL_LABELS)]
    detail_sheet = row(detail_names, detail_dir, 32, 10)

    width = max(comp_sheet.width, ruin_sheet.width, yard_sheet.width, detail_sheet.width, 900)
    total_h = section_title_h * 4 + comp_sheet.height + ruin_sheet.height + yard_sheet.height + detail_sheet.height + 40
    sheet = Image.new("RGBA", (width, total_h), (247, 239, 220, 255))
    d = ImageDraw.Draw(sheet)
    y = 6
    d.text((8, y), "hut-kit -- components.png (24 frames)", fill=(20, 20, 20, 255))
    y += section_title_h
    sheet.alpha_composite(comp_sheet, (0, y))
    y += comp_sheet.height + 4
    d.text((8, y), "ruins.png (8 frames)", fill=(20, 20, 20, 255))
    y += section_title_h
    sheet.alpha_composite(ruin_sheet, (0, y))
    y += ruin_sheet.height + 4
    d.text((8, y), "yards.png (5 frames)", fill=(20, 20, 20, 255))
    y += section_title_h
    sheet.alpha_composite(yard_sheet, (0, y))
    y += yard_sheet.height + 4
    d.text((8, y), "details.png (10 of 32 slots authored)", fill=(20, 20, 20, 255))
    y += section_title_h
    sheet.alpha_composite(detail_sheet, (0, y))

    sheet.save(f"{KIT_DIR}/contact-sheet.png")


if __name__ == "__main__":
    main()
