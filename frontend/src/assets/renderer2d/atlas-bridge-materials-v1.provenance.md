# Atlas bridge materials v1

Generated 2026-09-14 using the built-in image generation tool for the user-authorized inter-region bridge rebuild. No external assets or separate paid API client were used.

Source: `atlas-bridge-materials-v1.png`, 1254 by 1254 pixels. Runtime: `atlas-bridge-materials-v1.webp`, 1024 by 1024 pixels, cwebp quality 84, method 6; 271056 bytes. The only processing was resize/format compression. Four quadrants: oak decking, limestone paving, structural timber, foundation masonry.

Runtime SHA-256: `3a543e488b75550d142c280cfba828c6ac60c458548e17e22286003c4329e2bc`.

The material atlas supplies the bridge geometry painter; it does not alter world topology, navigation or agents. Shared runtime bitmap is 4 MiB decoded and leased through the normal atlas pool.

## Generation prompt

```text
Use case: stylized-concept
Asset type: production texture atlas for bridges in an orthographic 2.5D nature simulation game.
Create one square 1024 x 1024 image divided into an exact 2 by 2 grid of four opaque, edge-to-edge seamless material textures. No gutters, frames, labels, words, perspective, objects, scenery, water or transparent margins. Each quadrant is exactly 512 x 512. These are top-down PBR-like diffuse/albedo textures, with restrained hand-painted naturalism that suits a lush detailed pixel-world. Crisp fine material detail, muted natural colors; no dramatic baked lighting.
TOP LEFT: Weathered warm oak bridge deck, many narrow horizontal planks stacked vertically, subtle alternating shades, wood grain, small dark join lines, occasional paired old iron nail heads. Planks run left-right. No thick beams.
TOP RIGHT: An old warm gray limestone footbridge path, small irregular well-fitted stone pavers, subtle worn edges, slight moss in some mortar joins, muted gray-beige (not bright white).
BOTTOM LEFT: Dark aged chestnut structural timber. Long continuous straight grain runs left-right, narrow horizontal joined beams with subtle warm ridges, wood knots and old iron fastener details; rich restrained brown.
BOTTOM RIGHT: Rough gray-brown masonry, small hand-laid foundation stones, dark recessed mortar and subtle moss flecks; tactile and believable but with no grass or leaves.
All four quadrants fill their entire exact square with material. Orthographic flat texture study, not a picture of a bridge. No outer borders or drop shadows. Fine detail must still read when reduced for game use.
```
