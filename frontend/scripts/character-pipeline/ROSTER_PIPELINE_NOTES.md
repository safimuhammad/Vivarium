# Roster pipeline notes (from R1 / F1)

Written while deriving F1's 17 frames
(`frontend/assets/character-claude/roster/f1-sprites/`) so R2 (f2, f3, m2,
m3, m4) can move faster and avoid the same dead ends. Read alongside
`README.md` (the m1 chain) — this file only covers what's *different* or
*new* per character.

## 1. Nothing in `quantize.py` needs to change

Run it as-is per character:

```
venv/bin/python quantize.py roster/<id>-views.png roster/<id>-sprites 48
```

Figure spans are auto-detected; just sanity-check the printed span count is
3 and look at `preview.png`. `snap_palette(colors=16)` is shared across
front/back/side in one call — this is important: it means **the whole
character (all three views, and therefore every walk/pose frame derived
from them) shares one ≤16-color palette**. Any color you introduce by hand
later (highlights, pupils, mouth-dark, hem-sway fills, …) should be an
*existing* palette color, not a new one — reuse, don't invent. Verify the
final palette stays exactly what quantize produced with a full-file color
audit before writing `palette-sources.json`:

```python
from PIL import Image
from collections import Counter
import glob
counter = Counter()
for path in glob.glob("roster/<id>-sprites/*.png"):
    if "preview" in path or "16x" in path:
        continue
    im = Image.open(path).convert("RGBA")
    for p in im.getdata():
        if p[3] > 0:
            counter[p] += 1
print(len(counter), "colors")
```

## 2. ASCII-map first — use `ascii_map.py`

New tool, added in R1: `venv/bin/python ascii_map.py <sprite.png> [row0]
[row1]`. Prints a per-pixel letter grid with column ruler + an RGBA legend.
This is *how* you find eye/mouth/hem/arm coordinates instead of guessing —
map the front sprite (whole-face rows first, e.g. `0 20`, then torso/legs in
a second call), then the side sprite's torso/arm/leg region.

**Caveat**: letters are assigned per-invocation (first-seen order), so two
separate calls do not share a letter mapping — cross-reference by the
printed RGB tuple, not the letter, when comparing rows from different
calls. Also pair the ASCII map with a cropped, heavily-zoomed (24-30x) PNG
of the same region (`img.crop(...).resize(..., Image.Resampling.NEAREST)`)
— the letter grid tells you *where*, the zoomed crop tells you whether it
*reads right*.

## 3. Touch-up: always a new `touchup_<id>.py`, never edit `touchup_chibi.py`

Confirmed convention (and the only one that survives review — see §6). Each
character's face geometry, palette, and default quantize artifacts differ
enough that shared numeric constants don't transfer. Copy the *shape* of
`touchup_chibi.py`/`touchup_f1.py` (module docstring citing where the
coordinates came from, `DIR` pointing at that character's own sprites dir,
named color constants, an eyes/smile/strap pass, `main()` writing back
`front.png` + a `front-16x.png` zoom for the record).

What to actually look for when you ASCII-map the face:

- **Eye shape varies by source art, not just by character identity.** m1's
  raw quantize produced one wide dark blob across most of the face width
  (needed a full-width clear-then-redraw). F1's raw quantize instead
  produced two already-separated blobs with a clean skin nose-bridge gap
  (needed only a narrow clear + redraw). Don't assume you need the wide
  clear — check the map first.
- **Pick pupil columns symmetric around the sprite's true center**
  (`(width-1)/2`), not around whatever the raw blob's own center happens to
  be — the raw blob is rarely symmetric (bangs/hair asymmetry bleeds in).
- **Highlight placement**: put the highlight pixel on the *same-side*
  column of both eyes (e.g. both left columns) — that reads as one
  consistent light direction. Reuse an existing light palette color for it
  (F1 reused the blouse cream, matching m1's "shirt cream doubles as
  highlight" trick).
- **The "smile" patch may already exist from quantization** — check before
  hand-authoring one. F1's raw quantize left a 3x2 chin-shadow block that
  read as a blob, not a curve; the fix was narrowing it to a 2px hint on one
  row (m1's own scale: 2px, one row), not building a smile from scratch.
- Side/back sprites get **no eye/mouth touch-up** in either character's
  method — only `front.png` is touched.

## 4. `derive_frames.py`: `hip_frac` means different things for pants vs. skirts

- **Pants (m1)**: `hip_frac` targets the natural waist. The *entire* leg
  column (waist → boot) shifts together for contact frames, so there's
  never a static-fabric-vs-moving-leg seam.
- **Skirts**: judge `hip_frac` from the map as the **hem line** (where the
  skirt fabric ends and bare leg/ankle begins — look for the row where a
  solid one-piece silhouette first splits into two leg-shaped lobes), *not*
  the anatomical waist. If you target the waist for a skirt, the whole
  skirt-body column shifts with the legs and visibly shears/distorts the
  garment silhouette across the split.
- Even with the hem-line `hip_frac`, **the side view's contact frames can
  still show a "hem shear artifact"**: `contact_side`'s fore/aft column
  shift moves the ankle sideways by a full stride step, out from under the
  hem, leaving a gap. This is the plan's documented skirt-rule failure
  mode — check the side walk-strip preview specifically (crop+zoom the
  hem/boot rows) before accepting it.
- **Fallback, now built into `derive_frames.py`** (additive, m1's default
  behavior is unchanged): pass a 5th CLI arg, `boot_row` — the row where
  *solid boot color* begins (distinct from the thin ankle/hem-transition
  band directly under the hem). When present, the side view uses
  `contact_side_skirted` instead of `contact_side`:
  - the boot rows (`boot_row..bottom`) get the full stride step, split
    fore/aft as usual;
  - the thin ankle/hem-sliver band (`hip_row..boot_row`) gets a much
    smaller, fixed **1px sway** in the same direction, split by the *same*
    fore/aft reference point as the boots (not its own independent
    midpoint — a uniform, unsplit sway leaves the backward-stepping boot's
    gap almost as large as no sway at all).
  - Residual gap (`stride_step - sway`, e.g. 2 - 1 = 1px) is expected and
    matches the plan's "1px hem sway" framing — it reads as the boot
    peeking out from under a swinging hem, not as a defect. Don't chase it
    to zero.
  - Usage: `python derive_frames.py <dir> <hip_frac> <step> <bob>
    <boot_row>`. Omit `boot_row` entirely for non-skirted characters.
- Judge `boot_row` the same way as `hip_frac`: ASCII-map the side sprite's
  lower body and find the first row where boot-colored pixels (not
  skin/ankle) actually start.

## 5. Poses: always a new `poses_<id>.py`, never edit `poses.py`

**A parameterized, config-driven rewrite of `poses.py` itself was tried in
R1 and reverted** — the standing convention is per-character sibling
scripts (`poses_f1.py`), matching the `touchup_<id>.py` pattern, not a
shared config dict inside `poses.py`. Copy `poses_f1.py`'s shape: named
color constants (this character's own skin/pupil/top/mouth-dark, taken from
its palette, not another character's), the same 5 functions
(`front_blink`, `front_talk`, `side_reach`, `side_crouch`, `side_kneel`),
`main()` writing the 5 `pose-*.png` + `poses-preview.png`.

Per-function coordinate notes:

- **`front_blink`/`front_talk`**: reuse the eye/mouth coordinates from that
  character's own `touchup_<id>.py` — don't re-derive them.
- **`side_reach`**: erase the *hanging* arm/hand back to whatever garment is
  behind it, then draw a new arm extended forward at shoulder height.
  **Check where the hand rests before picking one erase-fill color.** F1's
  hand rests low enough (near the skirt waistline) that a single flat fill
  (the blouse color, m1's approach) left a wrong-garment cream patch inside
  the skirt. Fix: split the erase fill by a row threshold — one fill color
  above the garment boundary, a second below it. Judge the boundary row and
  both fill colors from the ASCII map of the *undisturbed* side sprite (not
  the erased one — read the "what's actually behind this row" colors from
  its immediate horizontal neighbors outside the arm's column range).
- **`side_crouch`/`side_kneel`**: m1's literal row numbers (`crouch_hip=33,
  crouch_bob=3`; `kneel_crop_row=33, legs_h=8, legs_y=40, torso_y=7`) worked
  unchanged for F1 (both are 48px-tall sprites with broadly similar
  proportions) — try them as a first draft before re-deriving from scratch,
  then compare the result against m1's shipped `pose-crouch.png` /
  `pose-kneel.png` side by side to judge if a character's proportions need
  different values.

## 6. `palette-sources.json`: derive by sampling, not by ASCII legend alone

The ASCII legend alone will mislead you — with only ~16 colors total, tones
get reused across roles (F1: the skin-shade tone doubles as strap/bag
leather; a hair-brown tone doubles as the bag pouch). To find the *true*
blouse/skirt-only colors:

1. Sample a small rectangle of the garment that's visually clear of straps,
   hair, and other accessories (e.g. a patch of skirt on the side opposite
   the bag) in front.png, back.png, and side.png; tally colors with
   `collections.Counter`.
2. Cross-check every candidate against a **pure hair-only** sample region
   (e.g. the middle of the back-view hair mass) to rule out contamination —
   a color that shows up in both a "garment" sample and the hair sample is
   not safe to remap.
3. Only list colors that came back clean in step 2. Exclude skin, hair,
   boots, and strap/bag leather even if they're visually "brownish" like
   the skirt — the structural-decision rule is blouse/top + skirt/trousers
   only.

`beingPalette.ts`'s existing `BEING_PALETTE_VARIANTS` names are
`slate-blue`, `violet-grey`, `moss`, `ochre`, `bone` — reuse those exact
names for the "suggested variant" field (don't invent new family names).

## 7. Visual-loop tiers that actually caught problems

Two zoom tiers, used together, not either alone:

- **Low zoom (6-8x), whole figure or whole strip** (`pxutil.contact_sheet`'s
  own preview output) — for gestalt/silhouette reads: does it look like the
  character, is the walk cycle readable, does a pose look like its name.
- **High zoom (20-30x), tight crop on the region in question** — for
  pixel-level judgment: exact eye symmetry, hem/boot seam pixels, whether
  an erase left a stray color patch. The stray skin patch in F1's reach
  pose (§5) and the side-view hem shear (§4) were both invisible at 6-8x
  and obvious at 20x+.

Always regenerate and re-look after *every* parameter change — a fix that
looks right in your head (e.g. the first "boots-only" sway attempt, which
had a filtering bug that silently no-op'd the sway) can still be wrong on
screen.

## 8. Output contract (per character)

Exactly these files in `roster/<id>-sprites/`, matching the 17-frame pose
parity contract (12 walk + 5 pose):

```
front.png back.png side.png                          # working intermediates
preview.png                                           # quantize verification
walk-down.png walk-up.png walk-side.png                # 4 frames each = 12
frames-preview.png                                     # derive_frames verification
pose-blink.png pose-talk.png pose-reach.png
pose-crouch.png pose-kneel.png                         # 5 single frames
poses-preview.png                                      # poses verification
front-16x.png                                          # touch-up zoom, for the record
palette-sources.json
```
