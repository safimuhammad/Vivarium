# Character asset pipeline (Approach A — reference-anchored sprites)

The approved pipeline that produced the chibi villager in
`frontend/assets/character-claude/`. Every stage is a deterministic script; the
creative act happens once (the generated reference + coordinate touch-ups) and is
visually verified at each step. No model ever draws pixels blind — that was the
failure mode of the rejected procedural approach (see
`docs/frontend/CHARACTER_PILOT_CRITIQUE_2026-07-23.md`).

## Chain

```
base-views-chibi.png            three-view reference (front/back/right), generated once
        │  quantize.py <ref> <out_dir> 48
        ▼
front/back/side.png             true-grid 22×48 sprites, shared 16-color palette,
        │                       despeckled (pxutil.mode_pool + snap_palette + despeckle)
        │  touchup_chibi.py     coordinate-level surgery: eyes + highlights, smile,
        ▼                       strap redraw (ASCII-map the sprite first to find coords)
        │  derive_frames.py <dir> 0.73 1 1
        ▼
walk-{down,up,side}.png         4-frame walk strips: contact/passing/contact/passing;
        │                       legs split by column offsets (never mirrored — mirroring
        │                       flips boot toes), 1px crouch bob, passing == idle
        │  poses.py
        ▼
pose-{blink,talk,reach,crouch,kneel}.png    the 5 pose-grammar frames
        │  build_pilot.py <dir> <template> <out.html>
        ▼
character-pilot-claude.html     self-contained pilot (sheets padded to common frame
                                width, data-URI embedded)
```

Run with the repo venv: `venv/bin/python <script>` (needs Pillow).

## Rules learned the hard way

- **Mode-pool, never average** when downscaling pixel art (averaging invents mud).
- **Despeckle after palette-snap** so color equality is exact.
- **Face pixel budget is proportions**: chibi ≈ 1/3-height head is what makes a
  readable face possible at 22px wide. Taller proportions cannot be fixed later.
- **Walk cadence must be distance-driven** (`frame = floor(distance/stride) % 4`),
  never timer-driven — timers cause foot-slide.
- **Verify visually at every stage** (each script writes a zoomed preview PNG).
  A stage's output is not done until a human-readable preview has been looked at.
