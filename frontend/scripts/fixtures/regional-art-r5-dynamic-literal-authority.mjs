/**
 * Test-only reviewed placements for the R5 A-prime dynamic presentation proof.
 *
 * The fixture is deliberately detached from the production compositor and the
 * rejected key-scene builders. It pins only runtime-owned presentation layers;
 * the 408 static atlas layers remain owned by the atlas-only scene authority.
 */

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const human = (kit, index, role, x, y) => ({
  id: `r5-dynamic/${kit}/human/${index}`,
  role,
  destination: { x, y, width: 48, height: 64 },
});

const scene = (kit, yardX, yardY, homeX, homeY, humans) => ({
  yard: {
    id: `r5-dynamic/${kit}/yard`,
    atlasId: `${kit}-home-yards`,
    cell: 0,
    destination: { x: yardX, y: yardY, width: 192, height: 160 },
  },
  homeActor: {
    id: `r5-dynamic/${kit}/home-actor`,
    componentAtlasId: `${kit}-home-components`,
    destination: { x: homeX, y: homeY, width: 128, height: 128 },
  },
  humans,
});

export const REGIONAL_R5_DYNAMIC_LITERAL_PLACEMENTS = deepFreeze({
  schema: "regional-r5-dynamic-presentation-placements/v1",
  scenes: {
    "ash-waste": scene("ash-waste", 528, 288, 560, 304, [
      human("ash-waste", 0, "route-entry", 120, 435),
      human("ash-waste", 1, "defining-landmark", 328, 195),
      human("ash-waste", 2, "shelter-door", 640, 367),
    ]),
    "dry-scrub": scene("dry-scrub", 560, 256, 592, 272, [
      human("dry-scrub", 0, "route-entry", 696, 51),
      human("dry-scrub", 1, "defining-landmark", 552, 99),
      human("dry-scrub", 2, "shelter-door", 672, 310),
    ]),
    "neutral-temperate": scene("neutral-temperate", 464, 320, 496, 336, [
      human("neutral-temperate", 0, "route-entry", 248, 19),
      human("neutral-temperate", 1, "defining-landmark", 168, 195),
      human("neutral-temperate", 2, "shelter-door", 576, 399),
    ]),
    "spring-terraces": scene("spring-terraces", 496, 288, 528, 304, [
      human("spring-terraces", 0, "route-entry", 24, 211),
      human("spring-terraces", 1, "defining-landmark", 72, 227),
      human("spring-terraces", 2, "shelter-door", 608, 367),
    ]),
    "worn-heartland": scene("worn-heartland", 528, 320, 560, 336, [
      human("worn-heartland", 0, "route-entry", 24, 83),
      human("worn-heartland", 1, "defining-landmark", 72, 99),
      human("worn-heartland", 2, "shelter-door", 640, 399),
    ]),
  },
});

// Recomputed independently by the RED contract from canonical JSON.
export const REGIONAL_R5_DYNAMIC_LITERAL_PLACEMENTS_SHA256 =
  "87368cedd56cb1ed08b48163f1ca7ec2ea0efea31c1342b48af66c6889c5a1c9";
