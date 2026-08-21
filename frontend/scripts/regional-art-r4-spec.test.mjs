import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import * as regionalR4Spec from "./regional-art-r4-spec.mjs";
import {
  REGIONAL_R4_KITS,
  REGIONAL_R4_SCENE_PLANS,
  REGIONAL_R4_VARIANT_RECIPES,
  validateRegionalR4Spec,
} from "./regional-art-r4-spec.mjs";

const EXPECTED_KITS = [
  "worn-heartland",
  "spring-terraces",
  "dry-scrub",
  "ash-waste",
  "neutral-temperate",
];

const EXPECTED_GROUND_FAMILY_MASK_DIGESTS = {
  "worn-heartland": "7e434de0438022ac16034bd4879f7cf3deb59ee6c796c080225df6369feed7f3",
  "spring-terraces": "c61b8d63af41f5854a34e894bc534d2dbf8b16c48d5b6a02791b9bb5be98370d",
  "dry-scrub": "1547e667002b50618ebe203ca46538d70a8c7966b9725c1489fc536638f5d47d",
  "ash-waste": "a71091da4195d04a4f167fd342ff207b1c6589f06173e6b61e792af91cf0313c",
  "neutral-temperate": "3420fdb050bb26ab8d3c2f19a7e1aced75e84991fabd2ded89ea9d6d9439facd",
};

const EXPECTED_LANDMARK_COUNTS = {
  "worn-heartland": {
    "old-oak-grove-composite": 3,
    "broken-fence-garden-composite": 3,
    "reclaimed-path-shoulder-composite": 2,
  },
  "spring-terraces": {
    "connected-spring-terrace-composite": 2,
    "spring-hillside-terrace-composite": 1,
    "reed-bank-composite": 1,
    "wet-stone-willow-composite": 2,
    "short-boardwalk-composite": 2,
  },
  "dry-scrub": {
    "sun-rock-outcrop-composite": 3,
    "deadwood-thorn-tangle-composite": 2,
    "wind-scrub-clump-composite": 3,
  },
  "ash-waste": {
    "nuclear-crater-fissure-composite": 2,
    "fractured-industrial-pylon-composite": 2,
    "slag-charred-ridge-composite": 2,
    "ash-debris-fan-composite": 2,
  },
  "neutral-temperate": {
    "restrained-broad-grove-composite": 3,
    "field-rock-boundary-composite": 2,
    "wildflower-verge-composite": 3,
  },
};

const EXPECTED_YARDS = [
  "standing-a-base",
  "standing-b-base",
  "warm-overlay",
  "durable-hoarding-overlay",
  "persistent-ruin-base",
];

const NATIVE_LANDMARK_IDENTITIES = {
  "worn-heartland": [
    ["worn-heartland:broad-crown", 0, 64, 112, "old-oak-grove-composite"],
    ["worn-heartland:split-crown", 1, 64, 112, "old-oak-grove-composite"],
    ["worn-heartland:wind-worn-crown", 2, 64, 112, "old-oak-grove-composite"],
    ["worn-heartland:open-south-gap", 3, 64, 96, "broken-fence-garden-composite"],
    ["worn-heartland:open-east-gap", 4, 64, 96, "broken-fence-garden-composite"],
    ["worn-heartland:diagonal-reclaimed-boundary", 5, 64, 96, "broken-fence-garden-composite"],
    ["worn-heartland:left-right-shoulder", 6, 64, 96, "reclaimed-path-shoulder-composite"],
    ["worn-heartland:top-bottom-shoulder", 7, 64, 96, "reclaimed-path-shoulder-composite"],
  ],
  "spring-terraces": [
    ["spring-terraces:curved-pool-rim", 0, 64, 80, "connected-spring-terrace-composite"],
    ["spring-terraces:stepped-pool-rim", 1, 64, 80, "connected-spring-terrace-composite"],
    ["spring-terraces:two-wet-stone-levels", 2, 64, 96, "spring-hillside-terrace-composite"],
    ["spring-terraces:broken-sight-gap", 3, 64, 96, "reed-bank-composite"],
    ["spring-terraces:willow-left", 4, 64, 112, "wet-stone-willow-composite"],
    ["spring-terraces:willow-right", 5, 64, 112, "wet-stone-willow-composite"],
    ["spring-terraces:north-south-planks", 6, 64, 64, "short-boardwalk-composite"],
    ["spring-terraces:east-west-planks", 7, 64, 64, "short-boardwalk-composite"],
  ],
  "dry-scrub": [
    ["dry-scrub:low-stepped-ridge", 0, 64, 104, "sun-rock-outcrop-composite"],
    ["dry-scrub:split-outcrop", 1, 64, 104, "sun-rock-outcrop-composite"],
    ["dry-scrub:wind-cut-diagonal-ridge", 2, 64, 104, "sun-rock-outcrop-composite"],
    ["dry-scrub:crescent-open-south", 3, 64, 104, "deadwood-thorn-tangle-composite"],
    ["dry-scrub:crescent-open-side", 4, 64, 104, "deadwood-thorn-tangle-composite"],
    ["dry-scrub:horizontal-wind", 5, 64, 96, "wind-scrub-clump-composite"],
    ["dry-scrub:rising-diagonal-wind", 6, 64, 96, "wind-scrub-clump-composite"],
    ["dry-scrub:falling-diagonal-wind", 7, 64, 96, "wind-scrub-clump-composite"],
  ],
  "ash-waste": [
    ["ash-waste:offset-crater-branching-fault", 0, 64, 64, "nuclear-crater-fissure-composite"],
    ["ash-waste:split-crater-service-fracture", 1, 64, 64, "nuclear-crater-fissure-composite"],
    ["ash-waste:snapped-cross-member", 2, 64, 116, "fractured-industrial-pylon-composite"],
    ["ash-waste:leaning-fractured-lattice", 3, 64, 116, "fractured-industrial-pylon-composite"],
    ["ash-waste:slag-ridge-char-stumps", 4, 64, 104, "slag-charred-ridge-composite"],
    ["ash-waste:industrial-aggregate-ridge", 5, 64, 104, "slag-charred-ridge-composite"],
    ["ash-waste:narrow-directional-fan", 6, 64, 88, "ash-debris-fan-composite"],
    ["ash-waste:joined-containment-debris-fan", 7, 64, 88, "ash-debris-fan-composite"],
  ],
  "neutral-temperate": [
    ["neutral-temperate:broad-crown", 0, 64, 112, "restrained-broad-grove-composite"],
    ["neutral-temperate:paired-trees", 1, 64, 112, "restrained-broad-grove-composite"],
    ["neutral-temperate:sparse-open-grove", 2, 64, 112, "restrained-broad-grove-composite"],
    ["neutral-temperate:boundary-open-south", 3, 64, 96, "field-rock-boundary-composite"],
    ["neutral-temperate:boundary-open-side", 4, 64, 96, "field-rock-boundary-composite"],
    ["neutral-temperate:left-verge", 5, 64, 96, "wildflower-verge-composite"],
    ["neutral-temperate:right-verge", 6, 64, 96, "wildflower-verge-composite"],
    ["neutral-temperate:diagonal-verge", 7, 64, 96, "wildflower-verge-composite"],
  ],
};

const MAX_CROSS_KIT_GROUND_SIMILARITY = 0.92;

const SCENERY_KIND_BASES = {
  "worn-heartland": { "old-oak": 0, "worn-stone": 1, "faded-flower": 2, "fallen-fence": 3 },
  "spring-terraces": { "terrace-rock": 0, willow: 1, "spring-flower": 2, "reed-bed": 3 },
  "dry-scrub": { "sun-rock": 0, deadwood: 1, "dry-grass": 2, thorn: 3 },
  "ash-waste": { "charred-trunk": 0, "slag-rock": 1, "ash-pile": 2, "bone-stone": 3 },
  "neutral-temperate": { "broad-tree": 0, "field-rock": 1, wildflower: 2, "soft-grass": 3 },
};

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function recursivelyFrozen(value, visited = new Set()) {
  if (value === null || typeof value !== "object" || visited.has(value)) return true;
  visited.add(value);
  return Object.isFrozen(value) && Object.values(value).every((entry) => recursivelyFrozen(entry, visited));
}

function values(value) {
  if (value === null || typeof value !== "object") return [value];
  return [value, ...Object.values(value).flatMap(values)];
}

function semanticTokens(value) {
  return values(value)
    .filter((entry) => typeof entry === "string")
    .flatMap((entry) => entry.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

function semanticCounts(recipes) {
  const counts = {};
  for (const recipe of recipes) counts[recipe.semanticKind] = (counts[recipe.semanticKind] ?? 0) + 1;
  return counts;
}

function geometryOnlyRecipe(recipe) {
  return {
    semanticKind: recipe.semanticKind,
    topologyKey: recipe.topologyKey,
    operations: recipe.operations.map(({ kind, points }) => ({ kind, points })),
  };
}

function normalizedGeometrySignature(recipe) {
  const geometry = geometryOnlyRecipe(recipe);
  const allPoints = geometry.operations.flatMap(({ points }) => points);
  const variants = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => {
    const transformed = allPoints.map(([x, y]) => [x * sx, y * sy]);
    const minX = Math.min(...transformed.map(([x]) => x));
    const minY = Math.min(...transformed.map(([, y]) => y));
    let cursor = 0;
    const operations = geometry.operations.map(({ kind, points }) => {
      const normalized = transformed.slice(cursor, cursor + points.length)
        .map(([x, y]) => [x - minX, y - minY])
        .sort(([ax, ay], [bx, by]) => ax - bx || ay - by);
      cursor += points.length;
      return { kind, points: normalized };
    }).sort((left, right) => canonical(left).localeCompare(canonical(right)));
    return canonical({ semanticKind: geometry.semanticKind, topologyKey: geometry.topologyKey, operations });
  });
  return variants.sort()[0];
}

function normalizedOperationGeometrySignature(recipe) {
  return normalizedGeometrySignature({
    ...recipe,
    semanticKind: "yard-geometry",
    topologyKey: "yard-geometry",
  });
}

function polygonContains(points, x, y) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [xi, yi] = points[index];
    const [xj, yj] = points[previous];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function groundMask(recipe) {
  const mask = new Set();
  for (const operation of recipe.operations) {
    if (operation.kind === "polygon") {
      for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
        if (polygonContains(operation.points, x + 0.5, y + 0.5)) mask.add(`${x},${y}`);
      }
    } else if (operation.kind === "cluster") {
      for (const [x, y] of operation.points) {
        mask.add(`${x},${y}`);
        mask.add(`${x + (x + 1 < 32 ? 1 : -1)},${y}`);
        mask.add(`${x},${y + (y + 1 < 32 ? 1 : -1)}`);
      }
    }
  }
  return [...mask].map((entry) => entry.split(",").map(Number));
}

function recipePixelMask(recipe, width, height) {
  const mask = new Set();
  for (const operation of recipe.operations) {
    if (operation.kind === "polygon") {
      const minY = Math.max(0, Math.floor(Math.min(...operation.points.map(([, y]) => y))));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(...operation.points.map(([, y]) => y))));
      for (let y = minY; y <= maxY; y += 1) {
        const crossings = [];
        for (let index = 0; index < operation.points.length; index += 1) {
          const [x1, y1] = operation.points[index];
          const [x2, y2] = operation.points[(index + 1) % operation.points.length];
          if ((y1 > y) === (y2 > y) || y1 === y2) continue;
          crossings.push(Math.round(x1 + (y - y1) * (x2 - x1) / (y2 - y1)));
        }
        crossings.sort((left, right) => left - right);
        for (let index = 0; index + 1 < crossings.length; index += 2) {
          for (let x = crossings[index]; x <= crossings[index + 1]; x += 1) {
            if (x >= 0 && x < width) mask.add(`${x},${y}`);
          }
        }
      }
    } else if (operation.kind === "cluster") {
      for (const [x, y] of operation.points) {
        mask.add(`${x},${y}`);
        mask.add(`${x + (x + 1 < width ? 1 : -1)},${y}`);
        mask.add(`${x},${y + (y + 1 < height ? 1 : -1)}`);
      }
    }
  }
  return mask;
}

function yardRecipeMetrics(recipe) {
  const width = 192;
  const height = 160;
  const mask = recipePixelMask(recipe, width, height);
  const coordinates = [...mask].map((entry) => entry.split(",").map(Number));
  const xs = coordinates.map(([x]) => x);
  const ys = coordinates.map(([, y]) => y);
  const bounds = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs) + 1,
    height: Math.max(...ys) - Math.min(...ys) + 1,
  };
  const coverage = (rectangle) => {
    let opaque = 0;
    for (let y = rectangle.y; y < rectangle.y + rectangle.height; y += 1) {
      for (let x = rectangle.x; x < rectangle.x + rectangle.width; x += 1) {
        if (mask.has(`${x},${y}`)) opaque += 1;
      }
    }
    return opaque / (rectangle.width * rectangle.height);
  };
  const transparent = new Set();
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!mask.has(`${x},${y}`)) transparent.add(`${x},${y}`);
  }
  let sockets = 0;
  while (transparent.size > 0) {
    const seed = transparent.values().next().value;
    const queue = [seed];
    transparent.delete(seed);
    let touchesEdge = false;
    let size = 0;
    while (queue.length > 0) {
      const [x, y] = queue.shift().split(",").map(Number);
      size += 1;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;
      for (const neighbor of [`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`]) {
        if (!transparent.delete(neighbor)) continue;
        queue.push(neighbor);
      }
    }
    if (!touchesEdge && size >= 64) sockets += 1;
  }
  const perimeterOpaque = coordinates.filter(([x, y]) => x < 4 || x >= 188 || y < 4 || y >= 156).length;
  const corridorOpaque = coordinates.filter(([x, y]) => x >= 80 && x < 112 && y >= 73).length;
  const outerEightPixels = coordinates.filter(([x, y]) => x < 8 || x >= 184 || y < 8 || y >= 152).length;
  const outerEightArea = width * height - (width - 16) * (height - 16);
  return {
    alphaCoverage: mask.size / (width * height),
    foundationCoverage: coverage({ x: 32, y: 48, width: 128, height: 64 }),
    transparentBoundsRatio: (bounds.width * bounds.height - mask.size) / (bounds.width * bounds.height),
    perimeterOpaque,
    corridorOpaque,
    outerEightCoverage: outerEightPixels / outerEightArea,
    sockets,
  };
}

function normalizedMaskVariants(recipe) {
  const mask = groundMask(recipe);
  return [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => {
    const transformed = mask.map(([x, y]) => [x * sx, y * sy]);
    const minX = Math.min(...transformed.map(([x]) => x));
    const minY = Math.min(...transformed.map(([, y]) => y));
    return new Set(transformed.map(([x, y]) => `${x - minX},${y - minY}`));
  });
}

function jaccard(left, right) {
  let intersection = 0;
  for (const key of left) if (right.has(key)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function groundGeometrySimilarity(left, right) {
  const leftMasks = normalizedMaskVariants(left);
  const rightMasks = normalizedMaskVariants(right);
  return Math.max(...leftMasks.flatMap((leftMask) => rightMasks.map((rightMask) => jaccard(leftMask, rightMask))));
}

function binaryCorrelation(pairs) {
  let sumLeft = 0;
  let sumRight = 0;
  let sumBoth = 0;
  for (const [left, right] of pairs) {
    sumLeft += left;
    sumRight += right;
    sumBoth += left * right;
  }
  const count = pairs.length;
  const numerator = count * sumBoth - sumLeft * sumRight;
  const denominator = Math.sqrt(
    (count * sumLeft - sumLeft ** 2) * (count * sumRight - sumRight ** 2),
  );
  return denominator === 0 ? 1 : numerator / denominator;
}

function groundGridMetrics(recipes, grid) {
  const masks = recipes.map((recipe) => {
    const occupied = new Set(groundMask(recipe).map(([x, y]) => `${x},${y}`));
    return Uint8Array.from({ length: 32 * 32 }, (_unused, pixel) => (
      occupied.has(`${pixel % 32},${Math.floor(pixel / 32)}`) ? 1 : 0
    ));
  });
  const shifts = [];
  for (let shift = 1; shift <= 8; shift += 1) for (const [dx, dy, axis] of [[shift, 0, "x"], [0, shift, "y"]]) {
    const pixelPairs = [];
    let coordinatePairs = 0;
    let sameVariantPairs = 0;
    for (let y = 0; y < 16 - dy; y += 1) for (let x = 0; x < 24 - dx; x += 1) {
      const leftVariant = grid[y][x];
      const rightVariant = grid[y + dy][x + dx];
      coordinatePairs += 1;
      if (leftVariant === rightVariant) sameVariantPairs += 1;
      for (let pixel = 0; pixel < 32 * 32; pixel += 1) {
        pixelPairs.push([masks[leftVariant][pixel], masks[rightVariant][pixel]]);
      }
    }
    shifts.push({
      axis,
      shift,
      coordinatePairs,
      sameVariantPairs,
      sameVariantRatio: sameVariantPairs / coordinatePairs,
      autocorrelation: Math.abs(binaryCorrelation(pixelPairs)),
    });
  }
  const counts = Array(8).fill(0);
  for (const row of grid) for (const variant of row) counts[variant] += 1;
  const adjacent = shifts.filter(({ shift }) => shift === 1);
  let maximumCardinalRun = 1;
  for (const row of grid) {
    let run = 1;
    for (let x = 1; x < row.length; x += 1) {
      run = row[x] === row[x - 1] ? run + 1 : 1;
      maximumCardinalRun = Math.max(maximumCardinalRun, run);
    }
  }
  for (let x = 0; x < grid[0].length; x += 1) {
    let run = 1;
    for (let y = 1; y < grid.length; y += 1) {
      run = grid[y][x] === grid[y - 1][x] ? run + 1 : 1;
      maximumCardinalRun = Math.max(maximumCardinalRun, run);
    }
  }
  let monochromeTwoByTwoCount = 0;
  for (let y = 0; y < grid.length - 1; y += 1) for (let x = 0; x < grid[0].length - 1; x += 1) {
    if (new Set([grid[y][x], grid[y][x + 1], grid[y + 1][x], grid[y + 1][x + 1]]).size === 1) {
      monochromeTwoByTwoCount += 1;
    }
  }
  let minimumFourByFourVariety = 8;
  for (let y = 0; y <= grid.length - 4; y += 1) for (let x = 0; x <= grid[0].length - 4; x += 1) {
    const variants = new Set();
    for (let offsetY = 0; offsetY < 4; offsetY += 1) for (let offsetX = 0; offsetX < 4; offsetX += 1) {
      variants.add(grid[y + offsetY][x + offsetX]);
    }
    minimumFourByFourVariety = Math.min(minimumFourByFourVariety, variants.size);
  }
  const materialZoneCounts = [Array(8).fill(0), Array(8).fill(0)];
  const materialZoneTotals = [0, 0];
  let familyAdjacentPairs = 0;
  let familyTransitions = 0;
  for (let y = 0; y < grid.length; y += 1) for (let x = 0; x < grid[0].length; x += 1) {
    const variant = grid[y][x];
    const family = variant >= 4 ? 1 : 0;
    materialZoneCounts[family][variant] += 1;
    materialZoneTotals[family] += 1;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      if (y + dy >= grid.length || x + dx >= grid[0].length) continue;
      familyAdjacentPairs += 1;
      if ((grid[y + dy][x + dx] >= 4 ? 1 : 0) !== family) familyTransitions += 1;
    }
  }
  return {
    counts,
    maximumVariantShare: Math.max(...counts) / 384,
    maximumMaterialZoneShare: Math.max(
      ...materialZoneCounts.map((zoneCounts, family) => Math.max(...zoneCounts) / materialZoneTotals[family]),
    ),
    clusteredMaterialShare: materialZoneTotals[1] / 384,
    familyTransitionRatio: familyTransitions / familyAdjacentPairs,
    adjacentSameVariantRatio: adjacent.reduce((sum, entry) => sum + entry.sameVariantPairs, 0)
      / adjacent.reduce((sum, entry) => sum + entry.coordinatePairs, 0),
    maximumCardinalRun,
    monochromeTwoByTwoCount,
    minimumFourByFourVariety,
    maximumCycleRatio: Math.max(...shifts.map(({ sameVariantRatio }) => sameVariantRatio)),
    maximumAutocorrelation: Math.max(...shifts.map(({ autocorrelation }) => autocorrelation)),
    shifts,
  };
}

function routeGrammar(plan) {
  return {
    start: plan.routeGrammar.start,
    turns: plan.routeGrammar.turns,
    terminus: plan.routeGrammar.terminus,
  };
}

function rectsTouchOrOverlap(left, right) {
  return left.x <= right.x + right.width
    && left.x + left.width >= right.x
    && left.y <= right.y + right.height
    && left.y + left.height >= right.y;
}

function cloneDefaultSpec() {
  return structuredClone({
    kits: REGIONAL_R4_KITS,
    variantRecipes: REGIONAL_R4_VARIANT_RECIPES,
    scenePlans: REGIONAL_R4_SCENE_PLANS,
  });
}

test("R4 Task 2 freezes the exact 105-recipe regional inventory", () => {
  assert.deepEqual(REGIONAL_R4_KITS, EXPECTED_KITS);
  assert.deepEqual(Object.keys(REGIONAL_R4_VARIANT_RECIPES), EXPECTED_KITS);
  assert.deepEqual(Object.keys(REGIONAL_R4_SCENE_PLANS), EXPECTED_KITS);
  assert.equal(recursivelyFrozen(REGIONAL_R4_KITS), true);
  assert.equal(recursivelyFrozen(REGIONAL_R4_VARIANT_RECIPES), true);
  assert.equal(recursivelyFrozen(REGIONAL_R4_SCENE_PLANS), true);

  let total = 0;
  for (const kit of EXPECTED_KITS) {
    const recipes = REGIONAL_R4_VARIANT_RECIPES[kit];
    assert.deepEqual([recipes.ground.length, recipes.landmarks.length, recipes.yards.length], [8, 8, 5]);
    assert.deepEqual(semanticCounts(recipes.landmarks), EXPECTED_LANDMARK_COUNTS[kit]);
    assert.deepEqual(recipes.yards.map(({ semanticKind }) => semanticKind), EXPECTED_YARDS);
    assert.equal(recipes.ground.filter(({ materialFamily }) => materialFamily === `${kit}:calm-ground`).length, 4);
    assert.equal(recipes.ground.filter(({ materialFamily }) => materialFamily === `${kit}:clustered-ground`).length, 4);
    total += recipes.ground.length + recipes.landmarks.length + recipes.yards.length;
  }
  assert.equal(total, 105);
  assert.deepEqual(validateRegionalR4Spec(), []);
});

test("R4 Task 2 recipes are inert integer-only kit-owned data with distinct geometry", () => {
  const recipes = EXPECTED_KITS.flatMap((kit) => Object.values(REGIONAL_R4_VARIANT_RECIPES[kit]).flat());
  assert.equal(values({ recipes }).some((value) => typeof value === "function"), false);
  assert.equal(new Set(recipes.map(({ id }) => id)).size, 105);
  assert.equal(new Set(recipes.map(canonical)).size, 105);
  assert.equal(new Set(recipes.map((recipe) => canonical(geometryOnlyRecipe(recipe)))).size, 105);
  assert.equal(new Set(recipes.map(normalizedGeometrySignature)).size, 105);

  for (const recipe of recipes) {
    const expectedKeys = ["id", "materialFamily", "operations", "recognitionTags", "semanticKind", "topologyKey"];
    if (recipe.materialFamily.endsWith(":landmark")) expectedKeys.push("cell", "contactPivotPx");
    assert.deepEqual(Object.keys(recipe).sort(), expectedKeys.sort());
    if (recipe.materialFamily.endsWith(":landmark")) {
      assert.ok(Number.isInteger(recipe.cell));
      assert.deepEqual(Object.keys(recipe.contactPivotPx).sort(), ["x", "y"]);
      assert.ok([recipe.contactPivotPx.x, recipe.contactPivotPx.y].every(Number.isInteger));
    }
    assert.ok(recipe.operations.length >= 2, `${recipe.id} operations`);
    assert.ok(recipe.recognitionTags.length >= 2, `${recipe.id} recognition tags`);
    for (const operation of recipe.operations) {
      assert.match(operation.kind, /^(polygon|rect|line|cluster)$/);
      if (operation.kind === "polygon" || operation.kind === "cluster") {
        assert.deepEqual(Object.keys(operation).sort(), ["kind", "material", "points"]);
        assert.ok(operation.points.length >= 2, `${recipe.id}/${operation.kind} points`);
        assert.ok(operation.points.flat().every(Number.isInteger), `${recipe.id}/${operation.kind} integer points`);
      } else if (operation.kind === "rect") {
        assert.deepEqual(Object.keys(operation).sort(), ["height", "kind", "material", "width", "x", "y"]);
        assert.ok([operation.x, operation.y, operation.width, operation.height].every(Number.isInteger));
      } else {
        assert.deepEqual(Object.keys(operation).sort(), ["from", "kind", "material", "to", "width"]);
        assert.ok([...operation.from, ...operation.to, operation.width].every(Number.isInteger));
      }
    }
  }
});

test("R4 Task 2 preserves all 40 native landmark identities, cells, and contact pivots", () => {
  for (const kit of EXPECTED_KITS) {
    const actual = REGIONAL_R4_VARIANT_RECIPES[kit].landmarks.map((recipe) => [
      recipe.id,
      recipe.cell,
      recipe.contactPivotPx?.x,
      recipe.contactPivotPx?.y,
      recipe.semanticKind,
    ]);
    assert.deepEqual(actual, NATIVE_LANDMARK_IDENTITIES[kit]);
    assert.ok(actual.every(([variantId]) => variantId.startsWith(`${kit}:`)));
  }
});

test("R4 Task 2 rejects shared cross-kit ground templates and one-pixel jitter evasions", () => {
  for (let leftKitIndex = 0; leftKitIndex < EXPECTED_KITS.length; leftKitIndex += 1) {
    for (let rightKitIndex = leftKitIndex + 1; rightKitIndex < EXPECTED_KITS.length; rightKitIndex += 1) {
      const leftKit = EXPECTED_KITS[leftKitIndex];
      const rightKit = EXPECTED_KITS[rightKitIndex];
      for (const left of REGIONAL_R4_VARIANT_RECIPES[leftKit].ground) {
        for (const right of REGIONAL_R4_VARIANT_RECIPES[rightKit].ground) {
          const similarity = groundGeometrySimilarity(left, right);
          assert.ok(
            similarity <= MAX_CROSS_KIT_GROUND_SIMILARITY,
            `${left.id}/${right.id}: metadata-stripped ground-mask similarity ${similarity.toFixed(4)}`,
          );
        }
      }
    }
  }

  const copied = structuredClone(REGIONAL_R4_VARIANT_RECIPES["ash-waste"].ground[0]);
  const jittered = structuredClone(copied);
  jittered.operations[0].points[0][0] += 1;
  assert.equal(groundGeometrySimilarity(copied, copied), 1);
  assert.ok(groundGeometrySimilarity(copied, jittered) > MAX_CROSS_KIT_GROUND_SIMILARITY);

  const hostile = cloneDefaultSpec();
  hostile.variantRecipes["ash-waste"].ground[0].operations = structuredClone(
    hostile.variantRecipes["worn-heartland"].ground[0].operations,
  );
  hostile.variantRecipes["ash-waste"].ground[0].operations[0].points[0][0] += 1;
  assert.match(validateRegionalR4Spec(hostile).join("\n"), /cross-kit ground-mask similarity/i);
});

test("R4 Task 2 ground grids use literal within-zone blue-noise without repetition cycles", () => {
  const diagnostics = [];
  const errors = [];
  for (const kit of EXPECTED_KITS) {
    const metrics = groundGridMetrics(
      REGIONAL_R4_VARIANT_RECIPES[kit].ground,
      REGIONAL_R4_SCENE_PLANS[kit].groundRecipeGrid,
    );
    diagnostics.push(`${kit}: adjacent=${metrics.adjacentSameVariantRatio.toFixed(4)} `
      + `autocorrelation=${metrics.maximumAutocorrelation.toFixed(4)} `
      + `cycle=${metrics.maximumCycleRatio.toFixed(4)} run=${metrics.maximumCardinalRun} `
      + `2x2=${metrics.monochromeTwoByTwoCount} min4x4=${metrics.minimumFourByFourVariety} `
      + `zone-share=${metrics.maximumMaterialZoneShare.toFixed(4)} `
      + `family-transition=${metrics.familyTransitionRatio.toFixed(4)}`);
    if (metrics.maximumVariantShare > 0.22) errors.push(`${kit}: variant dominance ${metrics.maximumVariantShare.toFixed(4)}`);
    if (metrics.adjacentSameVariantRatio > 0.22) errors.push(`${kit}: adjacent repetition ${metrics.adjacentSameVariantRatio.toFixed(4)}`);
    if (metrics.maximumAutocorrelation > 0.35) errors.push(`${kit}: ground-mask autocorrelation ${metrics.maximumAutocorrelation.toFixed(4)}`);
    if (metrics.maximumMaterialZoneShare > 0.5) errors.push(`${kit}: one recipe dominates its material zone`);
    if (metrics.clusteredMaterialShare < 0.3 || metrics.clusteredMaterialShare > 0.42) errors.push(`${kit}: calm/cluster zone balance drifted`);
    if (metrics.familyTransitionRatio > 0.16) errors.push(`${kit}: calm/cluster macro zones were globally shuffled`);
    if (metrics.maximumCardinalRun > 2) errors.push(`${kit}: cardinal same-ID run exceeds two`);
    if (metrics.monochromeTwoByTwoCount > 0) errors.push(`${kit}: monochrome 2x2 ground block`);
    if (metrics.minimumFourByFourVariety < 3) errors.push(`${kit}: interior 4x4 lacks three compatible variants`);
    for (const shift of metrics.shifts) {
      if (shift.coordinatePairs <= 0 || shift.sameVariantPairs <= 0 || shift.sameVariantPairs >= shift.coordinatePairs) {
        errors.push(`${kit}: ${shift.axis}${shift.shift} translated-cycle non-vacuity failed`);
      }
      if (shift.shift >= 2 && shift.sameVariantRatio === 1) errors.push(`${kit}: translated period ${shift.axis}${shift.shift}`);
    }
  }
  assert.deepEqual(errors, [], diagnostics.join("\n"));

  const hostile = cloneDefaultSpec();
  hostile.scenePlans["ash-waste"].groundRecipeGrid = Array.from({ length: 16 }, (_unused, y) => (
    Array.from({ length: 24 }, (_unused2, x) => (x + y * 4) % 8)
  ));
  assert.match(
    validateRegionalR4Spec(hostile).join("\n"),
    /ground-grid.*(?:autocorrelation|adjacency|cycle|period|run|zone)/i,
  );
});

test("R4 Task 2 pins macro family masks and isolates every repetition diagnostic", () => {
  for (const kit of EXPECTED_KITS) {
    const mask = REGIONAL_R4_SCENE_PLANS[kit].groundRecipeGrid
      .map((row) => row.map((variant) => Number(variant >= 4)));
    assert.equal(digest(mask), EXPECTED_GROUND_FAMILY_MASK_DIGESTS[kit], `${kit} approved family-mask digest`);
  }

  const familyDrift = cloneDefaultSpec();
  const ashGrid = familyDrift.scenePlans["ash-waste"].groundRecipeGrid;
  [ashGrid[0][0], ashGrid[2][5]] = [ashGrid[2][5], ashGrid[0][0]];
  assert.deepEqual(
    validateRegionalR4Spec(familyDrift).filter((error) => /ash-waste scene: ground-grid/i.test(error)),
    ["ash-waste scene: ground-grid calm/cluster family-mask drifted (cross-zone leakage/global shuffle)"],
  );

  const checkerboard = cloneDefaultSpec();
  const wornGrid = checkerboard.scenePlans["worn-heartland"].groundRecipeGrid;
  for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) wornGrid[y][x] = (y % 2) * 2 + (x % 2);
  assert.deepEqual(
    validateRegionalR4Spec(checkerboard).filter((error) => /worn-heartland scene: ground-grid/i.test(error)),
    ["worn-heartland scene: ground-grid within-family checkerboard/short period at 0,0"],
  );

  assert.equal(typeof regionalR4Spec.findRegionalR4TranslatedPeriods, "function");
  const rowOffsets = [0, 0, 1, 3, 2, 5, 1, 6, 4, 7, 2, 0, 5, 3, 7, 1];
  for (let fundamentalPeriod = 2; fundamentalPeriod <= 8; fundamentalPeriod += 1) {
    const exactPeriod = Array.from({ length: 16 }, (_unused, y) => (
      Array.from({ length: 24 }, (_unused2, x) => (x % fundamentalPeriod + rowOffsets[y]) % 8)
    ));
    const periods = regionalR4Spec.findRegionalR4TranslatedPeriods(exactPeriod);
    assert.ok(periods.includes(`x${fundamentalPeriod}`), `fundamental x${fundamentalPeriod} must be detected`);
    assert.equal(
      periods.some((period) => period.startsWith("x") && Number(period.slice(1)) < fundamentalPeriod),
      false,
      `x${fundamentalPeriod} fixture must not alias to a shorter translated period`,
    );
    const hostilePeriod = cloneDefaultSpec();
    hostilePeriod.scenePlans["ash-waste"].groundRecipeGrid = exactPeriod;
    assert.ok(
      validateRegionalR4Spec(hostilePeriod).includes(
        `ash-waste scene: ground-grid exact translated period x${fundamentalPeriod}`,
      ),
      `production validator must reject exact translated period x${fundamentalPeriod}`,
    );
  }

  const longRun = cloneDefaultSpec();
  longRun.scenePlans["worn-heartland"].groundRecipeGrid[0].splice(0, 3, 3, 3, 3);
  assert.deepEqual(
    validateRegionalR4Spec(longRun).filter((error) => /worn-heartland scene: ground-grid/i.test(error)),
    ["worn-heartland scene: ground-grid cardinal same-ID run exceeds two"],
  );

  const monochromeBlock = cloneDefaultSpec();
  const blockGrid = monochromeBlock.scenePlans["worn-heartland"].groundRecipeGrid;
  blockGrid[0].splice(0, 2, 2, 2);
  blockGrid[1].splice(0, 2, 2, 2);
  assert.deepEqual(
    validateRegionalR4Spec(monochromeBlock).filter((error) => /worn-heartland scene: ground-grid/i.test(error)),
    ["worn-heartland scene: ground-grid contains a monochrome 2x2"],
  );
});

test("R4 Task 2 owns five coordinate-distinct scene grammars and truthful regional sentences", () => {
  const plans = EXPECTED_KITS.map((kit) => REGIONAL_R4_SCENE_PLANS[kit]);
  assert.equal(new Set(plans.map((plan) => digest(routeGrammar(plan)))).size, 5);
  assert.equal(new Set(plans.map((plan) => digest(plan.routeTiles))).size, 5);
  assert.equal(new Set(plans.map((plan) => digest(plan.landmarks))).size, 5);
  assert.equal(new Set(plans.map((plan) => digest(plan.supports))).size, 5);
  assert.equal(new Set(plans.map((plan) => digest({
    routeTiles: plan.routeTiles,
    terrainPatches: plan.terrainPatches,
    groundRecipeGrid: plan.groundRecipeGrid,
    waterTiles: plan.waterTiles,
    shoreTiles: plan.shoreTiles,
    landmarks: plan.landmarks,
    supports: plan.supports,
    yard: plan.yard,
    home: plan.home,
  }))).size, 5);

  for (const plan of plans) {
    assert.deepEqual([plan.widthTiles, plan.heightTiles], [24, 16]);
    assert.deepEqual([plan.groundRecipeGrid.length, ...new Set(plan.groundRecipeGrid.map((row) => row.length))], [16, 24]);
    assert.equal(plan.routeTiles.some(({ x, y }) => x === 0 || x === 23 || y === 0 || y === 15), true);
    assert.deepEqual(plan.routeGrammar.start, plan.routeTiles[0]);
    assert.deepEqual(plan.routeGrammar.terminus, plan.routeTiles.at(-1));
    assert.ok(plan.terrainPatches.length >= 2 && plan.terrainPatches.length <= 3);
    assert.ok(plan.landmarks.length >= 4);
    for (const landmark of plan.landmarks) {
      assert.deepEqual(Object.keys(landmark).sort(), ["cell", "clusterId", "role", "variantId", "x", "y"]);
      assert.match(landmark.variantId, new RegExp(`^${plan.kitId}:`));
      assert.match(landmark.clusterId, /^[a-z][a-z0-9-]*$/);
      assert.match(landmark.role, /^[a-z]+(?:-[a-z]+)*$/);
      assert.ok([landmark.x, landmark.y, landmark.cell].every(Number.isInteger));
      const nativeIdentity = NATIVE_LANDMARK_IDENTITIES[plan.kitId]
        .find(([variantId]) => variantId === landmark.variantId);
      assert.ok(nativeIdentity, `${plan.kitId}/${landmark.variantId} native identity`);
      assert.equal(landmark.cell, nativeIdentity[1]);
      const contactNeighborhood = {
        x: landmark.x + nativeIdentity[2] - 48,
        y: landmark.y + nativeIdentity[3] - 32,
        width: 96,
        height: 64,
      };
      const supports = plan.supports.filter(({ clusterId, landmarkVariantId }) => (
        clusterId === landmark.clusterId && landmarkVariantId === landmark.variantId
      ));
      assert.ok(supports.length >= 2, `${plan.kitId}/${landmark.variantId} support ownership`);
      for (const support of supports) {
        assert.deepEqual(Object.keys(support).sort(), [
          "cell", "clusterId", "id", "landmarkVariantId", "role", "sceneryKind", "variantOrdinal", "x", "y",
        ]);
        assert.match(support.clusterId, /^[a-z][a-z0-9-]*$/);
        assert.match(support.role, /^[a-z]+(?:-[a-z]+)*$/);
        assert.ok([support.x, support.y, support.cell, support.variantOrdinal].every(Number.isInteger));
        assert.ok(support.variantOrdinal >= 0 && support.variantOrdinal <= 31);
        const baseCell = SCENERY_KIND_BASES[plan.kitId][support.sceneryKind];
        assert.ok(Number.isInteger(baseCell), `${plan.kitId}/${support.sceneryKind} scenery kind`);
        assert.equal(support.cell, baseCell + support.variantOrdinal * 4);
        assert.ok(rectsTouchOrOverlap(
          { x: support.x, y: support.y, width: 32, height: 32 },
          contactNeighborhood,
        ));
      }
    }
  }

  assert.deepEqual(REGIONAL_R4_SCENE_PLANS["dry-scrub"].waterTiles, []);
  assert.deepEqual(REGIONAL_R4_SCENE_PLANS["dry-scrub"].shoreTiles, []);
  assert.deepEqual(REGIONAL_R4_SCENE_PLANS["ash-waste"].waterTiles, []);
  assert.deepEqual(REGIONAL_R4_SCENE_PLANS["ash-waste"].shoreTiles, []);
  for (const kit of ["worn-heartland"]) {
    assert.deepEqual(REGIONAL_R4_SCENE_PLANS[kit].waterTiles, []);
    assert.deepEqual(REGIONAL_R4_SCENE_PLANS[kit].shoreTiles, []);
  }
  const spring = REGIONAL_R4_SCENE_PLANS["spring-terraces"];
  const neutral = REGIONAL_R4_SCENE_PLANS["neutral-temperate"];
  assert.ok(spring.waterTiles.length > 0 && spring.shoreTiles.length > 0);
  assert.ok(neutral.waterTiles.length > 0 && neutral.shoreTiles.length > 0);
  assert.notEqual(digest(spring.waterTiles), digest(neutral.waterTiles));
  assert.notEqual(digest(spring.shoreTiles), digest(neutral.shoreTiles));
  assert.ok(spring.waterTiles.length > neutral.waterTiles.length, "spring basin must be larger than neutral pond");
  assert.notEqual(digest(spring.landmarks), digest(neutral.landmarks));
  assert.notEqual(digest(REGIONAL_R4_SCENE_PLANS["worn-heartland"].landmarks), digest(neutral.landmarks));

  const ashPlan = REGIONAL_R4_SCENE_PLANS["ash-waste"];
  const ashTokens = semanticTokens({
    recipes: REGIONAL_R4_VARIANT_RECIPES["ash-waste"],
    kitId: ashPlan.kitId,
    sentence: ashPlan.sentence,
    terrainPatches: ashPlan.terrainPatches.map(({ id, role }) => ({ id, role })),
    landmarks: ashPlan.landmarks.map(({ variantId, clusterId, role }) => ({ variantId, clusterId, role })),
    supports: ashPlan.supports.map(({ id, clusterId, role, landmarkVariantId }) => ({ id, clusterId, role, landmarkVariantId })),
    yardRecipeId: ashPlan.yard.recipeId,
  });
  assert.ok(ashTokens.includes("industrial"));
  assert.ok(ashTokens.includes("irradiated") || ashTokens.includes("containment"));
  const forbiddenAshTokens = new Set(["living", "water", "spring", "garden", "moss", "flower", "barrel", "sign", "glow", "fantasy", "wizard", "rune", "medieval"]);
  assert.deepEqual(ashTokens.filter((token) => forbiddenAshTokens.has(token)), []);
});

test("R4 Task 2 rejects bounds-only scene placements as alternate geometry authority", () => {
  const hostile = cloneDefaultSpec();
  const landmark = hostile.scenePlans["worn-heartland"].landmarks[0];
  delete landmark.x;
  delete landmark.y;
  delete landmark.cell;
  landmark.contactBoundsTiles = { x: 2, y: 4, width: 2, height: 2 };
  const support = hostile.scenePlans["worn-heartland"].supports[0];
  delete support.x;
  delete support.y;
  delete support.cell;
  support.boundsTiles = { x: 1, y: 5, width: 1, height: 1 };

  const joined = validateRegionalR4Spec(hostile).join("\n");
  assert.match(joined, /landmark.*alternate bounds.*forbidden/i);
  assert.match(joined, /landmark.*integer x, y, and cell/i);
  assert.match(joined, /support.*alternate bounds.*forbidden/i);
  assert.match(joined, /support.*integer x, y, and cell/i);
});

test("R4 Task 2 yards preserve door geometry while rejecting ring and socket semantics", () => {
  for (const kit of EXPECTED_KITS) {
    const plan = REGIONAL_R4_SCENE_PLANS[kit];
    const { plotTile, plotCenterPx, doorTile, doorCenterPx } = plan.home;
    assert.deepEqual(plotCenterPx, { x: plotTile.x * 32 + 16, y: plotTile.y * 32 + 16 });
    assert.deepEqual(doorTile, { x: plotTile.x + 2, y: plotTile.y + 3 });
    assert.deepEqual(doorCenterPx, { x: plotCenterPx.x + 64, y: plotCenterPx.y + 96 });
    assert.deepEqual(plan.yard.originPx, { x: plotCenterPx.x - 32, y: plotCenterPx.y - 16 });
    assert.deepEqual(plan.yard.contactPivotPx, { x: 96, y: 112 });
    assert.deepEqual(plan.yard.connectionPorts, [{ side: "south", startPx: 80, widthPx: 32, role: "path" }]);
    assert.deepEqual(plan.yard.doorClearancePx, { x: 81, y: 73, width: 30, height: 48 });
    assert.deepEqual(plan.routeTiles.at(-1), doorTile);

    const yards = REGIONAL_R4_VARIANT_RECIPES[kit].yards;
    assert.notEqual(normalizedOperationGeometrySignature(yards[0]), normalizedOperationGeometrySignature(yards[1]));
    assert.notEqual(normalizedOperationGeometrySignature(yards[0]), normalizedOperationGeometrySignature(yards[4]));
    for (const recipe of yards) {
      const forbiddenYardTokens = new Set(["ring", "socket", "pedestal", "circle", "radial"]);
      assert.deepEqual(semanticTokens(recipe).filter((token) => forbiddenYardTokens.has(token)), []);
      assert.ok(recipe.recognitionTags.includes("open-south-corridor"));
      if (["standing-a-base", "standing-b-base", "persistent-ruin-base"].includes(recipe.semanticKind)) {
        assert.ok(recipe.recognitionTags.includes("foundation-connected"));
        assert.ok(recipe.recognitionTags.includes("ragged-apron"));
      } else {
        assert.ok(recipe.recognitionTags.includes("localized-overlay"));
      }
    }
  }
});

test("R4 Task 2 base-yard recipes own their open apron topology without renderer clearing", () => {
  const failures = [];
  for (const kit of EXPECTED_KITS) for (const recipeIndex of [0, 1, 4]) {
    const recipe = REGIONAL_R4_VARIANT_RECIPES[kit].yards[recipeIndex];
    const metrics = yardRecipeMetrics(recipe);
    const label = `${kit}/${recipe.id}`;
    if (metrics.perimeterOpaque !== 0) failures.push(`${label}: outer-4=${metrics.perimeterOpaque}`);
    if (metrics.corridorOpaque !== 0) failures.push(`${label}: corridor=${metrics.corridorOpaque}`);
    if (metrics.sockets !== 0) failures.push(`${label}: sockets=${metrics.sockets}`);
    if (metrics.foundationCoverage < 0.25) failures.push(`${label}: foundation=${metrics.foundationCoverage.toFixed(4)}`);
    if (metrics.transparentBoundsRatio < 0.25) failures.push(`${label}: transparent-bounds=${metrics.transparentBoundsRatio.toFixed(4)}`);
    if (metrics.alphaCoverage > 0.7) failures.push(`${label}: alpha=${metrics.alphaCoverage.toFixed(4)}`);
    if (metrics.outerEightCoverage < 0.01 || metrics.outerEightCoverage > 0.55) {
      failures.push(`${label}: ragged-outer8=${metrics.outerEightCoverage.toFixed(4)}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("R4 Task 2 validator reports every hostile contract break without short-circuiting", () => {
  const hostile = cloneDefaultSpec();
  hostile.kits.reverse();
  hostile.variantRecipes["dry-scrub"].ground[1].operations = structuredClone(
    hostile.variantRecipes["dry-scrub"].ground[0].operations,
  );
  hostile.variantRecipes["dry-scrub"].ground[2].operations[0].points[0][0] = 1.5;
  hostile.variantRecipes["dry-scrub"].ground[3].operations[0].material = "unknown-material";
  hostile.variantRecipes["dry-scrub"].ground[4].operations[0].draw = () => {};
  hostile.variantRecipes["dry-scrub"].yards[1].operations = structuredClone(
    hostile.variantRecipes["dry-scrub"].yards[0].operations,
  );
  hostile.scenePlans["ash-waste"].waterTiles.push({ x: 1, y: 1 });
  hostile.scenePlans["spring-terraces"].waterTiles = [];
  hostile.scenePlans["neutral-temperate"].routeTiles = structuredClone(
    hostile.scenePlans["worn-heartland"].routeTiles,
  );
  hostile.scenePlans["neutral-temperate"].routeGrammar = structuredClone(
    hostile.scenePlans["worn-heartland"].routeGrammar,
  );
  hostile.scenePlans["worn-heartland"].supports[0].clusterId = "orphan-cluster";
  hostile.scenePlans["worn-heartland"].yard.connectionPorts[0].startPx = 79;
  hostile.scenePlans["worn-heartland"].home.doorCenterPx.x += 1;

  const errors = validateRegionalR4Spec(hostile);
  assert.ok(errors.length >= 12, errors.join("\n"));
  const joined = errors.join("\n");
  for (const pattern of [
    /kit order/i,
    /duplicate.*geometry/i,
    /integer/i,
    /unknown material/i,
    /unknown operation key/i,
    /yard.*distinct/i,
    /ash.*waterless/i,
    /spring.*water/i,
    /route grammar.*duplicate/i,
    /support.*owner|orphan/i,
    /south port/i,
    /door.*equality/i,
    /recursively frozen/i,
  ]) assert.match(joined, pattern);
});
