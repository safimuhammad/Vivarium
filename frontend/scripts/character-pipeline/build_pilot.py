"""Fuse walk-sheet strips + the engine template into the final self-contained pilot.

Usage: python build_pilot.py <sheets_dir> <template.html> <out.html>
Expects <sheets_dir>/walk-{down,up,side}.png — horizontal 4-frame strips, equal frame size.
"""

from __future__ import annotations

import base64
import io
import json
import sys
from pathlib import Path

from PIL import Image

FRAMES = 4


def data_uri(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def main() -> None:
    sheets_dir, template_path, out_path = (Path(p) for p in sys.argv[1:4])
    strips = {d: Image.open(sheets_dir / f"walk-{d}.png").convert("RGBA")
              for d in ("down", "up", "side")}
    fw = max(im.size[0] // FRAMES for im in strips.values())   # common frame width
    fh = max(im.size[1] for im in strips.values())
    sheets: dict[str, str] = {}
    for direction, img in strips.items():
        own_fw = img.size[0] // FRAMES
        padded = Image.new("RGBA", (fw * FRAMES, fh), (0, 0, 0, 0))
        for i in range(FRAMES):                                 # center each frame
            frame = img.crop((i * own_fw, 0, (i + 1) * own_fw, img.size[1]))
            padded.alpha_composite(frame, (i * fw + (fw - own_fw) // 2, fh - img.size[1]))
        sheets[direction] = data_uri(padded)
    poses: dict[str, str] = {}
    for pose_file in sorted(sheets_dir.glob("pose-*.png")):
        img = Image.open(pose_file).convert("RGBA")
        canvas = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        canvas.alpha_composite(img, ((fw - img.size[0]) // 2, fh - img.size[1]))
        poses[pose_file.stem.removeprefix("pose-")] = data_uri(canvas)
    manifest = {"fw": fw, "fh": fh, "frames": FRAMES, "anchorY": fh - 2,
                "sheets": sheets, "poses": poses}
    html = template_path.read_text().replace("/*__SPRITES__*/", json.dumps(manifest))
    out_path.write_text(html)
    print(f"wrote {out_path} ({out_path.stat().st_size / 1024:.0f} KB, frame {fw}x{fh})")


if __name__ == "__main__":
    main()
