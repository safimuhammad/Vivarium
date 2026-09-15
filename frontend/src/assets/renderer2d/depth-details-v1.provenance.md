# depth-details-v1 provenance

- **Asset:** `frontend/src/assets/renderer2d/depth-details-v1.png`
- **Generation:** built-in `image_gen` tool, generated fresh after inspecting the repository references.
- **Reference images inspected for style:** `frontend/src/assets/renderer2d/regions/worn-heartland/scenery.png` (512 x 256 RGBA) and `frontend/src/assets/renderer2d/core/being-chibi.png` (110 x 1344 indexed PNG).
- **Selected generated source:** `/Users/safi/.codex/generated_images/01a09ef8-cb00-7f90-a556-22235ed7ee63/exec-0e861ffb-a769-4145-9d66-f3fd9bc2b62d.png`

## Final prompt

```text
Use case: stylized-concept
Asset type: game frontend environmental sprite atlas for a 2D pixel-art world renderer.
Primary request: Generate exactly ONE transparent environmental sprite atlas on a 1536 x 1024 pixel canvas, divided conceptually into a 3-column by 2-row layout of six equal 512 x 512 cells. Place exactly one fully isolated environmental sprite in each cell, row-major:
1. broad mossy oak with a substantial layered canopy and visible trunk;
2. elegant drooping willow with fresh jade leaves;
3. sculptural burnt cedar with charcoal and mauve branches plus reddish lichen;
4. layered red sandstone rock with a small ochre scrub;
5. weathered mossy stone well with a tiny wood roof and warm hanging lantern;
6. charming timber hut with a thick textured thatched roof, raised wooden porch, round window, and stacked firewood.
Input images: none as edit targets; previously inspected repository references establish the target language: existing scenery.png environmental sprites and being-chibi.png character sprites use compact, readable, muted earth-tone pixel art.
Scene/backdrop: genuinely transparent background across the entire atlas; no terrain, ground tiles, scenery, or backdrop between cells.
Subject: one physical environmental sprite per cell, each isolated with comfortable transparent margin. Keep each sprite inside its own 512 x 512 cell, max width 400 pixels and max height 400 pixels, with its foot/base baseline at y=440 within its cell.
Style/medium: painterly high-quality 16-bit pixel art, crisp pixel clusters and selective textured dithering, compatible with the repository's muted earth palettes. Upper-left lit three-quarter top-down RPG camera; each object must read as dimensional physical material with clear light and shadow, never a flat stamp.
Composition/framing: six equal cells in row-major order, exact 3 by 2 atlas arrangement, no separators, no gridlines, no overlap across cell boundaries. Leave transparent margins around every sprite.
Lighting/mood: consistent soft upper-left directional light, coherent subdued warm earth mood, restrained readable highlights.
Color palette: muted moss greens, cedar charcoal and mauve, dusty red sandstone, ochre, weathered stone gray, warm wood, fresh jade foliage, soft amber lantern glow.
Materials/textures: layered foliage, bark, lichen, stone strata, masonry, timber grain, thatch fibers, porch planks, firewood, and lantern glass rendered with deliberate pixel texture and depth.
Text (verbatim): none.
Constraints: true transparent alpha background, exact 1536 x 1024 canvas, six and only six isolated sprites, fixed cell order and baseline, no people or beings, no cast shadows outside a sprite's cell, no ground plane, no scene background, no labels.
Avoid: text, letters, numbers, logos, watermark, border, grid lines, checkerboard, opaque backdrop, ground tile, extra props, people, animals, duplicated sprites, clipping, overlap, flat vector shapes, photorealism, smooth anti-aliased painting.
```

## Validation

The selected PNG is 1536 x 1024, 8-bit RGBA, non-interlaced. The alpha channel has extrema 0..254; sampled outer/background pixels have alpha 0, so the backdrop is transparent in the file. The six row-major sprites are present and separated from one another.

The initial alpha > 16 measurements below were clipped to each nominal cell. They describe the content inside each cell, not each object's complete bounds:

| slot | content | local bbox | visible size | bottom y |
| --- | --- | --- | --- | --- |
| 1 | broad mossy oak | x=33..506, y=35..511 | 474 x 477 | 511 |
| 2 | drooping willow | x=41..491, y=40..511 | 451 x 472 | 511 |
| 3 | burnt cedar | x=71..478, y=32..511 | 408 x 480 | 511 |
| 4 | red sandstone rock | x=26..503, y=0..468 | 478 x 469 | 468 |
| 5 | mossy stone well | x=111..431, y=0..453 | 321 x 454 | 453 |
| 6 | timber hut | x=40..493, y=0..463 | 454 x 464 | 463 |

The generated art preserves true transparency, dimensions, row-major order, and requested subjects, but does **not** meet the requested maximum 400 x 400 bounds, local baseline y=440, or strict cell containment. Some tree roots cross the nominal row boundary. Runtime rectangles below account for that deviation.

## Runtime encoding and geometry

The PNG is kept as the generated source. `depth-details-v1.webp` is its same-size WebP encoding (Sharp, quality 86, alphaQuality 100, effort 6), with no resizing, repainting, or alpha editing. It is 512048 bytes, SHA-256 `890b3e67f8550e5f0ddee05a517a960cabda48208cddbbf0327818fa9e883c06` and 6291456 decoded RGBA bytes. Production reads measured per-object rectangles in `depth/DepthSceneryAssets.ts`, rather than clipping each object to the requested grid: some tree roots extend slightly below y=512, while the second-row objects begin well below that line. The atlas is an independent generated-art extension, not part of the older native pixel-art certification.
