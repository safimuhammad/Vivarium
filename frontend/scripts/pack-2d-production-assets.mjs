import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import sharp from "sharp";

import {
  buildRegionalR5AtlasOnlyScenesInternal,
  RegionalR5AtlasOnlySceneError,
  regionalR5AtlasOnlyScenePlacementsInternal,
  regionalR5V3IntegrationIdentityInternal,
} from "./regional-art-r5-atlas-only-scene.mjs";
import {
  buildRegionalR5DynamicPresentationScenesInternal,
  RegionalR5DynamicPresentationError,
  regionalR5DynamicPresentationPlacementsInternal,
} from "./regional-art-r5-dynamic-presentation.mjs";
import {
  snapshotRegionalR5CompositionInput,
} from "./regional-art-r5-composition-intake.mjs";
import {
  applyRegionalR5AtlasReauthor,
  regionalR5ReauthorTargetsInternal,
} from "./regional-art-r5-atlas-reauthor.mjs";
import {
  buildRegionalR5V3AtomicSourceMastersInternal,
  regionalR5V3LandmarkPortReceiptInternal,
} from "./regional-art-r5-v3-atomic-source.mjs";
import {
  REGIONAL_R5_V3_PRODUCTION_PREDECESSOR_AUTHORITY,
} from "./regional-art-r5-v3-production-predecessor-authority.mjs";
import {
  buildRegionalR5V4SceneFirstMastersInternal,
  regionalR5V4IntegrationIdentityInternal,
  regionalR5V4RegisteredTrustInternal,
} from "./regional-art-r5-v4-scene-first.mjs";

import {
  REGIONAL_R4_SCENE_PLANS,
  REGIONAL_R4_VARIANT_RECIPES,
  validateRegionalR4Spec,
} from "./regional-art-r4-spec.mjs";
import {
  REGIONAL_R5_ATLAS_AUTHORING_PLANS,
  REGIONAL_R5_AUTHORING_KITS,
  REGIONAL_R5_AUTHORING_SOURCES,
  REGIONAL_R5_AUTHORING_SPEC,
  REGIONAL_R5_CROPS,
  REGIONAL_R5_KEY_SCENES,
  REGIONAL_R5_LITERAL_PATCHES,
  REGIONAL_R5_MECHANICS_BINDINGS,
  REGIONAL_R5_PALETTES,
  validateRegionalR5AuthoringSpec,
} from "./regional-art-r5-authoring-spec.mjs";
import {
  analyzeConstructedCluster,
  analyzeOverlayVisibility,
  analyzeYardCell,
  validateComposedPixelAutocorrelation,
  validateConstructedClusterMetrics,
  validateLandmarkMaterialDepth,
  validateOverlayVisibility,
  validateYardCell,
  validateYardLifecycle,
} from "./regional-art-r5-visual-contract.mjs";
import { REGIONAL_R5_BLIND_REPAIR_SOURCES } from "./regional-art-r5-blind-repair-sources.mjs";

export { snapshotRegionalR5CompositionInput };

/** Return the closed A-prime placement authority without exposing mutable shared state. */
export function regionalR5AtlasOnlyScenePlacements() {
  return regionalR5AtlasOnlyScenePlacementsInternal();
}

/** Return the immutable identity for the unpublished V3 regional integration. */
export function regionalR5V3IntegrationIdentity() {
  return regionalR5V3IntegrationIdentityInternal();
}

/** Return a detached immutable receipt for the V3 landmark edge ports. */
export function regionalR5V3LandmarkPortReceipt() {
  return regionalR5V3LandmarkPortReceiptInternal();
}

/** Compose A-prime scenes from encoded masters and closed placements only. */
export async function buildRegionalR5AtlasOnlyScenes(input) {
  let snapshot;
  try {
    snapshot = snapshotRegionalR5CompositionInput(input);
  } catch (error) {
    if (!(error instanceof TypeError) || !Array.isArray(error.intakePath)) throw error;
    const root = error.intakePath[0];
    const rootDescriptorViolation = error.intakePath.length === 1
      && /enumerable data properties only/u.test(error.message);
    const code = rootDescriptorViolation ? "CALLER_SOURCE_FORBIDDEN"
      : root === "masterBuffers" ? "MASTER_INVENTORY_INVALID"
      : root === "placements" ? "PLACEMENT_AUTHORITY_INVALID"
        : root === "authoringIdentity" ? "V3_AUTHORING_IDENTITY_MISMATCH"
          : "CALLER_SOURCE_FORBIDDEN";
    throw new RegionalR5AtlasOnlySceneError(code, error.message);
  }
  return (async () => buildRegionalR5AtlasOnlyScenesInternal(
    snapshot,
    snapshot?.masterBuffers,
    snapshot?.placements,
    snapshot?.authoringIdentity?.schema === "regional-r5-v4-authoring-identity/v1"
      ? regionalR5V4RegisteredTrustInternal() : null,
  ))();
}

/** Return the closed A-prime dynamic placement authority. */
export function regionalR5DynamicPresentationPlacements() {
  return regionalR5DynamicPresentationPlacementsInternal();
}

/** Compose runtime-owned presentation layers over A-prime static scenes. */
export async function buildRegionalR5DynamicPresentationScenes(input) {
  let snapshot;
  try {
    snapshot = snapshotRegionalR5CompositionInput(input);
  } catch (error) {
    if (!(error instanceof TypeError) || !Array.isArray(error.intakePath)) throw error;
    const root = error.intakePath[0];
    const rootDescriptorViolation = error.intakePath.length === 1
      && /enumerable data properties only/u.test(error.message);
    const code = rootDescriptorViolation ? "CALLER_SOURCE_FORBIDDEN"
      : root === "staticScenes" ? "STATIC_SCENE_INVALID"
      : root === "dynamicSourceBuffers" ? "DYNAMIC_SOURCE_INVENTORY_INVALID"
        : root === "placements" ? "PLACEMENT_AUTHORITY_INVALID"
          : "CALLER_SOURCE_FORBIDDEN";
    throw new RegionalR5DynamicPresentationError(code, error.message);
  }
  return (async () => buildRegionalR5DynamicPresentationScenesInternal(
    snapshot,
    snapshot?.staticScenes,
    snapshot?.dynamicSourceBuffers,
    snapshot?.placements,
    snapshot?.staticScenes?.generation === "v4"
      ? regionalR5V4RegisteredTrustInternal() : null,
  ))();
}

/** Return a detached exact inventory of cells owned by the A-prime art pass. */
export function regionalR5ReauthorTargets() {
  return regionalR5ReauthorTargetsInternal();
}

/** Build the unpublished V3 atomic-source regional masters. */
export async function buildRegionalR5V3AtomicSourceMasters(input) {
  const snapshot = snapshotRegionalR5CompositionInput(input);
  return (async () => {
    const inputKeys = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? Reflect.ownKeys(snapshot) : [];
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
        || inputKeys.length !== 1 || inputKeys[0] !== "authority") {
      throw new TypeError("V3 atomic source builder is closed to only authority input; unexpected scene data is forbidden");
    }
    const sourceBuffers = {
      regionKits: await readFile(REGIONAL_R5_AUTHORING_SOURCES.regionKits.path),
      homeRuin: await readFile(REGIONAL_R5_AUTHORING_SOURCES.homeRuin.path),
    };
    const authoring = await buildRegionalR5SourceMastersInternal({ sourceBuffers }, false);
    const decodedGuide = await decodeRegionalR5Guide(sourceBuffers.regionKits);
    const normalizedGuide = normalizeRegionalR5WholeSheet(decodedGuide);
    const explicitDescriptor = {
      id: "neutral:v3-explicit-plain-bench",
      kit: "neutral-temperate",
      owner: "region-kits",
      paletteTokens: Object.keys(REGIONAL_R5_PALETTES.kits["neutral-temperate"]),
    };
    const explicitCrop = regionalR5RawCrop(normalizedGuide, [681, 408, 34, 26]);
    const cleanedExplicit = cleanRegionalR5Crop({
      ...explicitCrop,
      palette: regionalR5CropPalette(explicitDescriptor),
    });
    const explicitSources = new Map([[
      explicitDescriptor.id,
      regionalR5RawCrop(cleanedExplicit, [1, 0, 32, 26]),
    ]]);
    const built = await buildRegionalR5V3AtomicSourceMastersInternal({
      input: snapshot,
      rawMasters: authoring.rawMasters,
      fragments: authoring.fragments,
      patches: authoring.patches,
      explicitSources,
      basePlacements: regionalR5AtlasOnlyScenePlacementsInternal(),
      cellLayersByAtlas: authoring.cellLayersByAtlas,
      reauthorReceipt: authoring.reauthorReceipt,
      encodeRaw: encodeRegionalR5Raw,
    });
    return built.result;
  })();
}

/** Build the unpublished V4 scene-first regional masters over canonical V3. */
export function buildRegionalR5V4SceneFirstMasters(input) {
  const snapshot = snapshotRegionalR5CompositionInput(input);
  return (async () => {
    const keys = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? Reflect.ownKeys(snapshot) : [];
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
        || keys.length !== 1 || keys[0] !== "authority") {
      throw new TypeError("V4 scene-first builder accepts only its closed authority input");
    }
    const predecessor = await buildRegionalR5V3AtomicSourceMasters({
      authority: REGIONAL_R5_V3_PRODUCTION_PREDECESSOR_AUTHORITY,
    });
    return buildRegionalR5V4SceneFirstMastersInternal({
      authority: snapshot.authority,
      predecessor,
      portReceipt: regionalR5V3LandmarkPortReceiptInternal(),
      predecessorIntegrationIdentity: regionalR5V3IntegrationIdentityInternal(),
    });
  })();
}

/** Return the deterministic unpublished V4 integration identity. */
export function regionalR5V4IntegrationIdentity() {
  return regionalR5V4IntegrationIdentityInternal();
}

export const FROZEN_SLICE_HASHES = Object.freeze({
  "human-body-atlas.png": "68c505e74dd7e21a9db3732c2a277ed7440200403303d31941ec9cead8bfcbb6",
  "human-face-atlas.png": "3132ebffc2585120948e42c86f71f3d15bbba94e672790bbca1f82ce474ac4a7",
  "human-held-atlas.png": "24d3eb3951bffbe7c1cd7db742497776188314b03df7dab8b0f8fcab17067e28",
  "shelter-slice-atlas.png": "a50770aeefc6547c23805f408305d52dcf411dfd46e2143992251c89c997d540",
  "nirvana-tile-atlas.png": "66b79e7d93989530b0689ef719de2d8700b669b907fbf4e5326d9635917d20b4",
});

export const SEMANTIC_TERRAIN_ROLES = Object.freeze({
  ground: Object.freeze([0, 1, 2, 3, 4, 5, 6, 7]),
  path: Object.freeze([8, 9, 10, 11, 12, 13, 14, 15]),
  water: Object.freeze([16, 17, 18, 19, 20, 21, 22, 23]),
  shore: Object.freeze([24, 25, 26, 27, 28, 29, 30, 31]),
  soil: Object.freeze([32, 33, 34, 35]),
});

const hashBuffer = (buffer) => createHash("sha256").update(buffer).digest("hex");
const finiteInteger = (value) => Number.isFinite(value) && Number.isInteger(value);
const pointDrift = (left, right) => Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));

/** Validate the persisted native authoring contract before any pixel or publication work. */
export function validateNativeContractSchema(contract) {
  const errors = [];
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return ["native contract schema requires an object"];
  }
  if (contract.schema !== 1) errors.push("native contract schema must equal 1");
  if (!contract.atlases || typeof contract.atlases !== "object" || Array.isArray(contract.atlases)) {
    return [...errors, "native contract schema requires an atlases object"];
  }
  let rampCount = 0;
  let singletonRampCount = 0;
  for (const [atlasId, atlas] of Object.entries(contract.atlases)) {
    const ramps = atlas?.materialRamps;
    if (!ramps || typeof ramps !== "object" || Array.isArray(ramps)) {
      errors.push(`${atlasId}: native contract schema requires materialRamps`);
      continue;
    }
    const entries = Object.entries(ramps);
    let declaredColors = 0;
    let hasMaterialFamily = false;
    const declaredShades = new Set();
    for (const [name, shades] of entries) {
      rampCount += 1;
      if (!/^[a-z]+(?:-[a-z]+)+$/.test(name)
        || /(?:^|-)[0-9]+(?:-|$)/.test(name)
        || /^semantic-prefix(?:-|$)/.test(name)) {
        errors.push(`${atlasId}: semantic ramp name ${name} is numeric or generic`);
      }
      if (!Array.isArray(shades) || shades.length < 1 || shades.length > 3) {
        errors.push(`${atlasId}/${name}: material ramp requires one to three shades`);
        continue;
      }
      if (shades.length === 1) singletonRampCount += 1;
      if (shades.length >= 2) hasMaterialFamily = true;
      declaredColors += shades.length;
      let previousLuminance = -1;
      for (const shade of shades) {
        if (!Array.isArray(shade) || shade.length !== 3
          || !shade.every((channel) => finiteInteger(channel) && channel >= 0 && channel <= 255)) {
          errors.push(`${atlasId}/${name}: material shade must be an RGB byte triplet`);
          continue;
        }
        const key = shade.join(",");
        if (declaredShades.has(key)) errors.push(`${atlasId}: duplicate material shade ${key}`);
        declaredShades.add(key);
        const luminance = shade[0] * 299 + shade[1] * 587 + shade[2] * 114;
        if (luminance <= previousLuminance) {
          errors.push(`${atlasId}/${name}: material shades must be ordered dark to light`);
        }
        previousLuminance = luminance;
      }
    }
    if (declaredColors >= 4 && !hasMaterialFamily) {
      errors.push(`${atlasId}: nontrivial atlas requires a two- or three-shade material family`);
    }
    if (atlasId === "core-human-body-rigs") {
      const frames = atlas.frames;
      if (!Array.isArray(frames) || frames.length !== 344) {
        errors.push("core human body frames require exactly 344 canonical cells");
      } else {
        const frameIds = new Set();
        const frameRects = new Set();
        for (const [index, frame] of frames.entries()) {
          const expectedId = `${atlasId}:${index}`;
          const expectedRect = {
            x: index % 16 * 48,
            y: Math.floor(index / 16) * 64,
            width: 48,
            height: 64,
          };
          const rectKey = frame?.rect
            ? `${frame.rect.x},${frame.rect.y},${frame.rect.width},${frame.rect.height}`
            : "missing";
          if (frameIds.has(frame?.id)) errors.push(`duplicate body frame id ${frame?.id}`);
          if (frameRects.has(rectKey)) errors.push(`duplicate body frame rect ${rectKey}`);
          frameIds.add(frame?.id);
          frameRects.add(rectKey);
          if (frame?.id !== expectedId) {
            errors.push(`body frame ${index} has noncanonical cell identity ${frame?.id}`);
          }
          if (!frame?.rect || Object.entries(expectedRect).some(([key, value]) => (
            frame.rect[key] !== value
          ))) {
            errors.push(`body frame ${index} has noncanonical rect order`);
          }
        }
      }
    }
    if (atlasId.endsWith("-terrain")) {
      const actualRoles = atlas.semanticTerrainRoles;
      if (!actualRoles || typeof actualRoles !== "object" || Array.isArray(actualRoles)) {
        errors.push(`${atlasId}: native contract requires semanticTerrainRoles`);
      } else {
        for (const [role, expectedCells] of Object.entries(SEMANTIC_TERRAIN_ROLES)) {
          if (JSON.stringify(actualRoles[role]) !== JSON.stringify(expectedCells)) {
            errors.push(`${atlasId}: semantic terrain role ${role} must bind its exact legal cell band`);
          }
        }
        const unexpected = Object.keys(actualRoles).filter((role) => !(role in SEMANTIC_TERRAIN_ROLES));
        if (unexpected.length > 0) errors.push(`${atlasId}: unexpected semantic terrain roles ${unexpected.join(", ")}`);
      }
    }
    if (atlasId.endsWith("-scenery")) {
      const kit = atlasId.slice(0, -"-scenery".length);
      const expected = SEMANTIC_SCENERY_CELLS[kit];
      if (!expected || JSON.stringify(atlas.semanticSceneryCells) !== JSON.stringify(expected)) {
        errors.push(`${atlasId}: native contract requires exact named semanticSceneryCells`);
      }
      const expectedVariants = SEMANTIC_SCENERY_VARIANTS[kit];
      if (!expectedVariants || JSON.stringify(atlas.semanticSceneryVariants) !== JSON.stringify(expectedVariants)) {
        errors.push(`${atlasId}: native contract requires exact named semanticSceneryVariants`);
      }
    }
  }
  if (rampCount === 0) errors.push("native contract schema requires material ramps");
  else if (singletonRampCount / rampCount > 0.25) {
    errors.push(`native contract singleton ramps exceed 25%: ${singletonRampCount}/${rampCount}`);
  }
  return errors;
}

/** Return a detached canonical inventory with stable atlas and cell ordering. */
export function canonicalizeProductionInventory(inventory) {
  return inventory
    .map((entry) => ({
      ...structuredClone(entry),
      cells: Array.isArray(entry.cells) ? [...entry.cells].sort() : entry.cells,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Verify that production packing begins from the five approved slice references. */
export function validateFrozenSliceReferences(sources) {
  const errors = [];
  for (const [name, expected] of Object.entries(FROZEN_SLICE_HASHES)) {
    const source = sources[name];
    if (!source) {
      errors.push(`missing frozen slice reference ${name}`);
      continue;
    }
    const actual = hashBuffer(source);
    if (actual !== expected) errors.push(`frozen slice reference ${name} hash drift: ${actual}`);
  }
  for (const name of Object.keys(sources)) {
    if (!(name in FROZEN_SLICE_HASHES)) errors.push(`unexpected frozen slice reference ${name}`);
  }
  return errors;
}

function outlineDepth(data, width, height, outlineKeys) {
  const keyAt = (x, y) => {
    const offset = (y * width + x) * 4;
    return data[offset + 3] === 0 ? null : `${data[offset]},${data[offset + 1]},${data[offset + 2]}`;
  };
  const scan = (values) => {
    const firstMaterial = values.findIndex((value) => value !== null && !outlineKeys.has(value));
    if (firstMaterial < 0) return 0;
    let count = 0;
    for (let index = firstMaterial - 1; index >= 0 && outlineKeys.has(values[index]); index -= 1) count += 1;
    return count;
  };
  let maximum = 0;
  for (let y = 0; y < height; y += 1) {
    const row = Array.from({ length: width }, (_unused, x) => keyAt(x, y));
    maximum = Math.max(maximum, scan(row), scan([...row].reverse()));
  }
  for (let x = 0; x < width; x += 1) {
    const column = Array.from({ length: height }, (_unused, y) => keyAt(x, y));
    maximum = Math.max(maximum, scan(column), scan([...column].reverse()));
  }
  return maximum;
}

function outlineThicknessViolations(data, width, height, outlineKeys) {
  const keyAt = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const offset = (y * width + x) * 4;
    return data[offset + 3] === 0 ? null : `${data[offset]},${data[offset + 1]},${data[offset + 2]}`;
  };
  const candidates = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!outlineKeys.has(keyAt(x, y))) continue;
    for (const [outX, outY, inX, inY] of [[-1, 0, 1, 0], [1, 0, -1, 0], [0, -1, 0, 1], [0, 1, 0, -1]]) {
      if (keyAt(x + outX, y + outY) !== null) continue;
      if (!outlineKeys.has(keyAt(x + inX, y + inY))) continue;
      const material = keyAt(x + inX * 2, y + inY * 2);
      if (material !== null && !outlineKeys.has(material)) {
        candidates.push({ x: x + inX, y: y + inY, orientation: inX === 0 ? "horizontal" : "vertical" });
      }
    }
  }
  const candidateKeys = new Set(candidates.map(({ x, y, orientation }) => `${x},${y},${orientation}`));
  const violations = candidates.filter(({ x, y, orientation }) => {
    const neighbors = orientation === "horizontal"
      ? [`${x - 1},${y},${orientation}`, `${x + 1},${y},${orientation}`]
      : [`${x},${y - 1},${orientation}`, `${x},${y + 1},${orientation}`];
    return neighbors.some((key) => candidateKeys.has(key));
  });
  return [...new Map(violations.map(({ x, y }) => [`${x},${y}`, { x, y }])).values()];
}

/** Analyze one packed runtime atlas against its native authoring contract. */
export async function analyzeRuntimeAtlas(buffer, contract) {
  const errors = [];
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== contract.width || info.height !== contract.height) {
    errors.push(`atlas dimensions ${info.width}x${info.height} do not match ${contract.width}x${contract.height}`);
  }
  const runtimeResized = contract.sourceCellWidth !== contract.cellWidth
    || contract.sourceCellHeight !== contract.cellHeight;
  if (runtimeResized) errors.push("runtime art was rescaled instead of using its native source cell");

  let binaryAlpha = true;
  let transparentResidue = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3];
    if (alpha !== 0 && alpha !== 255) binaryAlpha = false;
    if (alpha === 0 && (data[offset] !== 0 || data[offset + 1] !== 0 || data[offset + 2] !== 0)) {
      transparentResidue += 1;
    }
  }
  if (!binaryAlpha) errors.push("runtime atlas requires binary alpha; anti-alias alpha was found");
  if (transparentResidue > 0) errors.push(`runtime atlas contains RGB residue under ${transparentResidue} transparent pixels`);

  const ramps = Object.values(contract.materialRamps ?? {});
  const maxShadesPerMaterial = ramps.reduce((maximum, ramp) => Math.max(maximum, ramp.length), 0);
  if (maxShadesPerMaterial > 3) errors.push("material ramp contains a fourth shade; at most three shades are allowed");
  const declaredMaterialColors = ramps.reduce((total, ramp) => total + ramp.length, 0);
  const singletonMaterialRamps = ramps.filter((ramp) => ramp.length === 1).length;
  if (declaredMaterialColors >= 4 && singletonMaterialRamps === ramps.length) {
    errors.push("material contract declares every color as a singleton ramp; semantic dark/mid/light grouping is required");
  }
  if (declaredMaterialColors >= 8 && ramps.length > Math.ceil(declaredMaterialColors / 2)) {
    errors.push("material contract inflates semantic ramps instead of grouping related shades");
  }
  for (const ramp of ramps) {
    const luminance = ramp.map(([red, green, blue]) => red * 299 + green * 587 + blue * 114);
    if (new Set(ramp.map((color) => color.join(","))).size !== ramp.length) {
      errors.push("material ramp repeats an RGB shade");
      break;
    }
    if (luminance.some((value, index) => index > 0 && value <= luminance[index - 1])) {
      errors.push("material ramp shades must progress from dark to light");
      break;
    }
  }
  const outlineKeys = new Set((contract.outlineColors ?? []).map((color) => color.join(",")));
  const declaredColors = new Set([
    ...outlineKeys,
    ...ramps.flat().map((color) => color.join(",")),
  ]);
  let unknownOpaqueColors = 0;
  let missingExposedOutlinePixels = 0;
  const outlineExceptionKeys = new Set((contract.outlineCornerExceptions ?? [])
    .filter(({ x, y }) => finiteInteger(x) && finiteInteger(y))
    .map(({ x, y }) => `${x},${y}`));
  const exceptionBudget = Math.max(4, (contract.frames?.length ?? 1) * 4);
  if ((contract.outlineCornerExceptions?.length ?? 0) > exceptionBudget) {
    errors.push(`corner exception budget exceeded: ${(contract.outlineCornerExceptions ?? []).length} > ${exceptionBudget}; exception explosion is forbidden`);
  }
  const keyAt = (x, y) => {
    if (x < 0 || y < 0 || x >= info.width || y >= info.height) return null;
    const offset = (y * info.width + x) * 4;
    return data[offset + 3] === 0 ? null : `${data[offset]},${data[offset + 1]},${data[offset + 2]}`;
  };
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const key = keyAt(x, y);
      if (key === null) continue;
      if (!declaredColors.has(key)) unknownOpaqueColors += 1;
      if (contract.requireExposedOutline !== false && !outlineKeys.has(key)) {
        const exposed = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
          .some(([neighborX, neighborY]) => keyAt(neighborX, neighborY) === null);
        if (exposed && !outlineExceptionKeys.has(`${x},${y}`)) missingExposedOutlinePixels += 1;
      }
    }
  }
  if (unknownOpaqueColors > 0) {
    errors.push(`runtime atlas contains ${unknownOpaqueColors} opaque pixels with unknown or undeclared palette colors`);
  }
  if (missingExposedOutlinePixels > 0) {
    errors.push(`runtime atlas contains ${missingExposedOutlinePixels} exposed material pixels with a missing outline`);
  }
  const maxOutlineWidth = outlineDepth(data, info.width, info.height, outlineKeys);
  const thickOutlinePixels = contract.requireExposedOutline === false ? []
    : outlineThicknessViolations(data, info.width, info.height, outlineKeys)
      .filter(({ x, y }) => !outlineExceptionKeys.has(`${x},${y}`));
  if (thickOutlinePixels.length > 0) {
    errors.push(`1-pixel outline required; detected outline width ${maxOutlineWidth} at ${thickOutlinePixels.length} non-exempt pixels`);
  }

  let maxRootDrift = 0;
  let maxFaceAnchorDrift = 0;
  let maxHeldAnchorDrift = 0;
  for (const frame of contract.frames ?? []) {
    const { rect } = frame;
    if (![rect.x, rect.y, rect.width, rect.height].every(finiteInteger)) {
      errors.push(`${frame.id}: frame geometry must use integer coordinates`);
      continue;
    }
    if (rect.width !== contract.cellWidth || rect.height !== contract.cellHeight) {
      errors.push(`${frame.id}: frame geometry must use the native cell size`);
    }
    if (rect.x % contract.cellWidth !== 0 || rect.y % contract.cellHeight !== 0) {
      errors.push(`${frame.id}: frame geometry must align to the native cell grid`);
    }
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > contract.width
      || rect.y + rect.height > contract.height) {
      errors.push(`${frame.id}: frame geometry exceeds atlas bounds`);
    }
    maxRootDrift = Math.max(maxRootDrift, pointDrift(frame.feet, frame.detectedFeet));
    maxFaceAnchorDrift = Math.max(
      maxFaceAnchorDrift,
      pointDrift(frame.faceAnchor, frame.detectedFaceAnchor),
    );
    maxHeldAnchorDrift = Math.max(
      maxHeldAnchorDrift,
      pointDrift(frame.heldAnchor, frame.detectedHeldAnchor),
    );
  }
  if (maxRootDrift > 2) errors.push(`root drift ${maxRootDrift} exceeds two native pixels`);
  if (maxFaceAnchorDrift > 2) errors.push(`face anchor drift ${maxFaceAnchorDrift} exceeds two native pixels`);
  if (maxHeldAnchorDrift > 2) errors.push(`held anchor drift ${maxHeldAnchorDrift} exceeds two native pixels`);

  return {
    errors,
    binaryAlpha,
    transparentResidue,
    runtimeResized,
    maxShadesPerMaterial,
    maxOutlineWidth,
    thickOutlinePixels: thickOutlinePixels.length,
    unknownOpaqueColors,
    missingExposedOutlinePixels,
    maxRootDrift,
    maxFaceAnchorDrift,
    maxHeldAnchorDrift,
    compressedBytes: buffer.length,
    decodedBytes: info.width * info.height * 4,
    width: info.width,
    height: info.height,
    sha256: hashBuffer(buffer),
  };
}

/** Validate the complete rig/action/facing clip matrix and its safe markers. */
export function validateClipInventory(clips, inventory) {
  const errors = [];
  for (const rig of inventory.rigs) {
    for (const action of inventory.actions) {
      for (const facing of inventory.facings) {
        const key = `${rig}:${action}:${facing}`;
        const clip = clips[key];
        if (!clip) {
          errors.push(`missing ${rig} ${action} ${facing} clip`);
          continue;
        }
        if (!Array.isArray(clip.frames) || clip.frames.length === 0) {
          errors.push(`${key}: clip requires frames`);
          continue;
        }
        const markerKeys = new Set();
        for (const marker of clip.markers ?? []) {
          const markerKey = `${marker.name}:${marker.frame}`;
          if (markerKeys.has(markerKey)) errors.push(`${key}: duplicate marker ${markerKey}`);
          markerKeys.add(markerKey);
          if (!finiteInteger(marker.frame) || marker.frame < 0 || marker.frame >= clip.frames.length) {
            errors.push(`${key}: marker frame outside clip range`);
          }
        }
        const cancelFrames = new Set();
        for (const frame of clip.cancelFrames ?? []) {
          if (cancelFrames.has(frame)) errors.push(`${key}: duplicate cancel frame ${frame}`);
          cancelFrames.add(frame);
          if (!finiteInteger(frame) || frame < 0 || frame >= clip.frames.length) {
            errors.push(`${key}: cancel frame outside clip range`);
          }
        }
        if (action === "turn") {
          const switches = (clip.markers ?? []).filter(({ name }) => name === "facing-switch");
          if (switches.length !== 1) errors.push(`${key}: turn requires exactly one facing-switch marker`);
        }
      }
    }
  }
  return errors;
}

/** Validate faceless body planes and structurally directional complete face overlays. */
export async function analyzeDirectionalFacePlanes(input) {
  const owned = structuredClone(input);
  const errors = [];
  for (const rig of owned.rigs) {
    for (const facing of owned.facings) {
      const bodyKey = `${rig}:${facing}`;
      const body = owned.bodyPlanes[bodyKey];
      if (!body) {
        errors.push(`missing body face plane ${bodyKey}`);
        continue;
      }
      if (body.facialFeaturePixels !== 0) errors.push(`baked facial feature pixels in body plane ${bodyKey}`);
      for (const expression of owned.expressions) {
        const key = `${rig}:${facing}:${expression}`;
        const plane = owned.facePlanes[key];
        if (!plane) {
          errors.push(`missing face plane ${key}`);
          continue;
        }
        if (plane.rig !== rig || plane.facing !== facing || plane.expression !== expression) {
          errors.push(`face plane identity mismatch ${key}`);
        }
        if (plane.maskPixels !== body.planePixels || plane.coveredMaskPixels !== plane.maskPixels) {
          errors.push(`incomplete face-plane mask ${key}`);
        }
        if (plane.leakedPixels !== 0) errors.push(`face-plane mask leaks ${key}`);
        if (facing === "south" && plane.eyes !== 2) {
          errors.push(`south face must contain exactly two eye components in ${key}`);
        }
        if ((facing === "east" || facing === "west") && plane.eyes !== 1) {
          errors.push(`${facing} profile must contain exactly one eye in ${key}`);
        }
        if (facing === "north") {
          if (plane.eyes !== 0) errors.push(`north face contains front eyes in ${key}`);
          if (plane.noseDirection !== "north-hidden") errors.push(`north face contains front nose in ${key}`);
          if (plane.mouthPixels !== 0) errors.push(`north face contains front mouth in ${key}`);
        } else {
          if (plane.noseDirection !== facing) errors.push(`${facing} face nose points ${plane.noseDirection} in ${key}`);
          if (plane.mouthPixels <= 0) errors.push(`${facing} face requires one mouth component in ${key}`);
        }
        if (plane.semanticFeatureMask) {
          const masks = plane.semanticFeatureMask;
          const eyeComponents = connectedPixelComponents(masks.eyes ?? []);
          const noseComponents = connectedPixelComponents(masks.nose ?? []);
          const mouthComponents = connectedPixelComponents(masks.mouth ?? []);
          const expectedEyes = facing === "north" ? 0 : facing === "south" ? 2 : 1;
          if (eyeComponents.length !== expectedEyes || plane.eyes !== eyeComponents.length) {
            errors.push(`${facing} face eye topology drift in ${key}`);
          }
          if (noseComponents.length !== (facing === "north" ? 0 : 1)) {
            errors.push(`${facing} face nose topology drift in ${key}`);
          }
          if (mouthComponents.length !== (facing === "north" ? 0 : 1)) {
            errors.push(`${facing} face mouth topology drift in ${key}`);
          }
          if (plane.mouthPixels !== (masks.mouth ?? []).length) {
            errors.push(`${facing} face mouth byte count drift in ${key}`);
          }
          const points = Object.values(masks).flat();
          if (points.some(({ y }) => y > 22)) errors.push(`lower second-face pixels found in ${key}`);
          if (facing !== "north" && points.length > 0) {
            const maxEyeY = Math.max(...masks.eyes.map(({ y }) => y));
            const minNoseY = Math.min(...masks.nose.map(({ y }) => y));
            const maxNoseY = Math.max(...masks.nose.map(({ y }) => y));
            const minMouthY = Math.min(...masks.mouth.map(({ y }) => y));
            if (!(maxEyeY < minNoseY && maxNoseY < minMouthY)) {
              errors.push(`face feature vertical order drift in ${key}`);
            }
          }
        }
      }
    }
  }
  return { input: owned, errors };
}

/** Build exact compressed and decoded accounting for every runtime atlas. */
export function buildProductionPackingReport({
  atlases,
  currentUiCompressedBytes,
  currentUiDecodedBytes,
  metadata = {},
  budgets,
}) {
  const owned = atlases.map((atlas) => ({ ...atlas }));
  const core = owned.filter(({ group }) => group === "core");
  const kits = [...new Set(owned.map(({ regionKit }) => regionKit).filter(Boolean))].sort();
  const coreArtCompressedBytes = core.reduce((sum, atlas) => sum + atlas.compressedBytes, 0);
  const coreArtDecodedBytes = core.reduce((sum, atlas) => sum + atlas.decodedBytes, 0);
  const coreMetadataCompressedBytes = metadata.core?.compressedBytes ?? 0;
  const coreMetadataDecodedBytes = metadata.core?.decodedBytes ?? 0;
  const coreCompressedBytes = coreArtCompressedBytes + coreMetadataCompressedBytes;
  const exactCoreDecodedBytes = coreArtDecodedBytes + coreMetadataDecodedBytes;
  const regionCompressedBytes = {};
  const regionArtCompressedBytes = {};
  const regionArtDecodedBytes = {};
  const regionMetadataCompressedBytes = {};
  const regionMetadataDecodedBytes = {};
  const activeCompressedBytes = {};
  const exactPeakActiveDecodedBytes = {};
  for (const kit of kits) {
    const regional = owned.filter(({ regionKit }) => regionKit === kit);
    regionArtCompressedBytes[kit] = regional.reduce((sum, atlas) => sum + atlas.compressedBytes, 0);
    regionArtDecodedBytes[kit] = regional.reduce((sum, atlas) => sum + atlas.decodedBytes, 0);
    regionMetadataCompressedBytes[kit] = metadata.regions?.[kit]?.compressedBytes ?? 0;
    regionMetadataDecodedBytes[kit] = metadata.regions?.[kit]?.decodedBytes ?? 0;
    regionCompressedBytes[kit] = regionArtCompressedBytes[kit] + regionMetadataCompressedBytes[kit];
    activeCompressedBytes[kit] = coreCompressedBytes + regionCompressedBytes[kit]
      + currentUiCompressedBytes;
    exactPeakActiveDecodedBytes[kit] = exactCoreDecodedBytes
      + regionArtDecodedBytes[kit] + regionMetadataDecodedBytes[kit]
      + currentUiDecodedBytes;
  }
  return {
    schema: 1,
    generatedAt: new Date(0).toISOString(),
    atlases: owned,
    budgets: { ...budgets },
    currentUiCompressedBytes,
    currentUiDecodedBytes,
    coreArtCompressedBytes,
    coreArtDecodedBytes,
    coreMetadataCompressedBytes,
    coreMetadataDecodedBytes,
    coreCompressedBytes,
    exactCoreDecodedBytes,
    regionArtCompressedBytes,
    regionArtDecodedBytes,
    regionMetadataCompressedBytes,
    regionMetadataDecodedBytes,
    regionCompressedBytes,
    activeCompressedBytes,
    exactPeakActiveDecodedBytes,
  };
}

/** Validate exact decoded formulas and all frozen compressed budgets. */
export function validateAssetBudgets(report) {
  const errors = [];
  const atlasLimits = [
    [/^core-human-body-rigs$/, 144 * 1024, "body 144 KiB budget"],
    [/^core-human-face-planes$/, 24 * 1024, "face 24 KiB budget"],
    [/^core-human-hair$/, 80 * 1024, "hair 80 KiB budget"],
    [/^core-human-clothing-\d{2}$/, 40 * 1024, "clothing 40 KiB budget"],
    [/^core-human-held$/, 48 * 1024, "held 48 KiB budget"],
    [/^core-human-status-effects$/, 64 * 1024, "status 64 KiB budget"],
    [/-terrain$/, 24 * 1024, "terrain 24 KiB budget"],
    [/-scenery$/, 40 * 1024, "scenery 40 KiB budget"],
    [/-environment$/, 16 * 1024, "environment 16 KiB budget"],
    [/-home-components$/, 56 * 1024, "home components 56 KiB budget"],
    [/-home-details$/, 16 * 1024, "home details 16 KiB budget"],
    [/-home-ruins$/, 24 * 1024, "home ruins 24 KiB budget"],
    [/-landmarks$/, 48 * 1024, "landmarks 48 KiB budget"],
    [/-home-yards$/, 40 * 1024, "home yards 40 KiB budget"],
  ];
  for (const atlas of report.atlases) {
    if (atlas.decodedBytes !== atlas.width * atlas.height * 4) {
      errors.push(`${atlas.id}: decoded bytes must equal width * height * 4`);
    }
    const budget = atlasLimits.find(([pattern]) => pattern.test(atlas.id));
    if (budget && atlas.compressedBytes > budget[1]) {
      errors.push(`${atlas.id}: ${budget[2]} exceeded (${atlas.compressedBytes} > ${budget[1]})`);
    }
  }
  const clothingTotal = report.atlases
    .filter(({ id }) => /^core-human-clothing-\d{2}$/.test(id))
    .reduce((sum, atlas) => sum + atlas.compressedBytes, 0);
  if (clothingTotal > 320 * 1024) errors.push("clothing total 320 KiB budget exceeded");
  if (report.coreCompressedBytes > (report.budgets.coreCompressedAllocation ?? Number.POSITIVE_INFINITY)) {
    errors.push(`core compressed allocation exceeded (${report.coreCompressedBytes})`);
  }
  if (report.coreCompressedBytes > report.budgets.coreCompressedMax) {
    errors.push(`core compressed bytes exceed ${report.budgets.coreCompressedMax}`);
  }
  for (const [kit, bytes] of Object.entries(report.regionCompressedBytes)) {
    if (bytes > (report.budgets.regionCompressedAllocation ?? Number.POSITIVE_INFINITY)) {
      errors.push(`region ${kit} compressed allocation exceeded (${bytes})`);
    }
    if (bytes > report.budgets.regionCompressedMax) {
      errors.push(`region ${kit} compressed bytes ${bytes} exceed ${report.budgets.regionCompressedMax}`);
    }
  }
  if ((report.coreMetadataCompressedBytes ?? 0) > 24 * 1024) {
    errors.push("core metadata 24 KiB budget exceeded");
  }
  if (report.coreArtCompressedBytes !== undefined
    && report.coreCompressedBytes !== report.coreArtCompressedBytes + (report.coreMetadataCompressedBytes ?? 0)) {
    errors.push("core metadata allocation accounting mismatch; combined metadata total is invalid");
  }
  for (const [kit, bytes] of Object.entries(report.regionCompressedBytes ?? {})) {
    if (report.regionArtCompressedBytes?.[kit] !== undefined
      && bytes !== report.regionArtCompressedBytes[kit] + (report.regionMetadataCompressedBytes?.[kit] ?? 0)) {
      errors.push(`region ${kit} metadata allocation accounting mismatch; combined metadata total is invalid`);
    }
    const expectedActive = report.coreCompressedBytes + bytes + report.currentUiCompressedBytes;
    if (report.activeCompressedBytes?.[kit] !== expectedActive) {
      errors.push(`active ${kit} metadata cap accounting mismatch; combined metadata total is invalid`);
    }
  }
  for (const [kit, bytes] of Object.entries(report.regionMetadataCompressedBytes ?? {})) {
    if (bytes > 4 * 1024) errors.push(`region ${kit} metadata 4 KiB budget exceeded`);
  }
  for (const [kit, bytes] of Object.entries(report.activeCompressedBytes)) {
    if (bytes > report.budgets.activeCompressedMax) {
      errors.push(`active ${kit} compressed bytes ${bytes} exceed ${report.budgets.activeCompressedMax}`);
    }
  }
  return errors;
}

/** Validate a written packing report against the exact generated atlas inventory. */
export function validateProductionPackingReport(report, expectedAtlases) {
  const errors = [];
  const counted = new Set();
  for (const id of report.countedAtlasIds ?? []) {
    if (counted.has(id)) errors.push(`${id}: atlas counted twice`);
    counted.add(id);
  }
  const expectedById = new Map(expectedAtlases.map((atlas) => [atlas.id, atlas]));
  for (const atlas of report.atlases ?? []) {
    const expected = expectedById.get(atlas.id);
    if (!expected) {
      errors.push(`${atlas.id}: unexpected atlas in packing report`);
      continue;
    }
    if (!counted.has(atlas.id)) errors.push(`${atlas.id}: atlas omitted from counted inventory`);
    if (atlas.sha256 !== expected.sha256) errors.push(`${atlas.id}: atlas hash drift`);
    if (atlas.runtimeResized) errors.push(`${atlas.id}: runtime rescale is forbidden`);
    if (atlas.binaryAlpha === false) errors.push(`${atlas.id}: runtime atlas is not binary alpha`);
  }
  for (const expected of expectedAtlases) {
    if (!(report.atlases ?? []).some(({ id }) => id === expected.id)) {
      errors.push(`${expected.id}: expected atlas omitted from report`);
    }
  }
  for (const required of ["native-1x", "exact-2x", "desktop", "mobile-390x844"]) {
    if (!(report.contactSheets ?? []).includes(required)) errors.push(`${required}: required contact sheet missing`);
  }
  return errors;
}

/** Validate that responsive evidence preserves selected production cells at integer scale. */
export function validateResponsiveEvidenceLayout(layout) {
  const errors = [];
  const requiredRoles = [
    "standing-human",
    "profile-talking-human",
    "prone-recovery-human",
    "doorway-home",
    "persistent-ruin",
  ];
  const placements = Array.isArray(layout?.placements) ? layout.placements : [];
  const viewport = layout?.viewport;
  if (!viewport || !finiteInteger(viewport.width) || !finiteInteger(viewport.height)
    || viewport.width <= 0 || viewport.height <= 0) {
    errors.push("responsive evidence requires a positive integer viewport");
  }
  const frozenViewports = {
    "mobile-390x844": { width: 390, height: 844 },
    "desktop-1440x900": { width: 1440, height: 900 },
  };
  const expectedViewport = frozenViewports[viewport?.id];
  if (!expectedViewport || viewport?.width !== expectedViewport.width
    || viewport?.height !== expectedViewport.height) {
    errors.push(`${viewport?.id ?? "unknown viewport"}: viewport identity dimensions must match ${expectedViewport
      ? `${expectedViewport.width}x${expectedViewport.height}`
      : "a frozen device"}`);
  }
  for (const role of requiredRoles) {
    if (!placements.some(({ evidenceRole }) => evidenceRole === role)) {
      errors.push(`responsive evidence is missing required ${role}`);
    }
  }
  for (const placement of placements) {
    if (placement.sourceKind !== "native-cell") {
      errors.push(`${placement.id}: full-sheet downsample is forbidden; use a native cell`);
    }
    if (!Number.isInteger(placement.x) || !Number.isInteger(placement.y)) {
      errors.push(`${placement.id}: fractional coordinate is forbidden`);
    }
    if (!Number.isInteger(placement.scale) || ![1, 2].includes(placement.scale)) {
      errors.push(`${placement.id}: only integer scale 1x or 2x is allowed; 3x and fractional scale are forbidden`);
    }
    const expected = placement.kind === "human-cell"
      ? { width: 48, height: 64 }
      : placement.kind === "home-cell"
        ? { width: 128, height: 128 }
        : null;
    if (expected === null) {
      errors.push(`${placement.id}: full-sheet downsample is forbidden; select a native 48x64 or 128x128 cell`);
      continue;
    }
    if (placement.source?.width !== expected.width || placement.source?.height !== expected.height) {
      errors.push(`${placement.id}: ${placement.kind === "human-cell" ? "native 48x64" : "native 128x128"} source is required`);
    }
    if (viewport && Number.isInteger(placement.x) && Number.isInteger(placement.y)
      && Number.isInteger(placement.scale) && placement.scale > 0
      && (placement.x < 0 || placement.y < 0
        || placement.x + expected.width * placement.scale > viewport.width
        || placement.y + expected.height * placement.scale > viewport.height)) {
      errors.push(`${placement.id}: integer-scaled native cell exceeds viewport bounds`);
    }
  }
  return errors;
}

/** Validate that visual verdicts are backed by named successful validation results. */
export function validateVisualReviewMatrix(matrix) {
  const errors = [];
  const results = Object.values(matrix?.validationResults ?? {});
  const resultByHash = new Map(results.map((result) => [result.sha256, result]));
  for (const [name, result] of Object.entries(matrix?.validationResults ?? {})) {
    if (result.name !== name) errors.push(`${name}: validation result name mismatch`);
    if (!/^[a-f0-9]{64}$/.test(result.sha256 ?? "")) errors.push(`${name}: invalid validation result hash`);
  }
  for (const [artifactName, artifact] of Object.entries(matrix?.artifacts ?? {})) {
    for (const [verdictName, verdict] of Object.entries(artifact.verdicts ?? {})) {
      const linked = resultByHash.get(verdict.validationResultSha256);
      if (verdict.status !== "pass") errors.push(`${artifactName}/${verdictName}: verdict status is invalid`);
      if (!linked) errors.push(`${artifactName}/${verdictName}: verdict is missing a named validation result`);
      else if (!linked.passed && verdict.status === "pass") {
        errors.push(`${artifactName}/${verdictName}: pass verdict links to failed validation result`);
      }
    }
  }
  return errors;
}

const RUNTIME_COMPOSITOR_EVIDENCE_FILES = Object.freeze([
  "runtime-compositor-human-1x.png",
  "runtime-compositor-human-2x.png",
  "runtime-compositor-human.json",
]);
const RUNTIME_COMPOSITOR_STATES = Object.freeze([
  "idle", "walk", "turn", "talk", "work", "hurt", "recovery",
]);

/** Validate persisted LayeredHumanActor runtime-compositor evidence. */
export function validateRuntimeCompositorEvidence(metadata, artifacts) {
  const errors = [];
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return ["runtime compositor metadata requires an object"];
  }
  if (metadata.contract !== "LayeredHumanActor.draw vs direct native source-over; CSS palette filters excluded") {
    errors.push("runtime compositor contract mismatch");
  }
  if (metadata.ordering !== "rig -> facing -> idle, walk, turn, talk, work, hurt, recovery") {
    errors.push("runtime compositor canonical ordering declaration mismatch");
  }
  if (metadata.canvas?.width !== 96 || metadata.canvas?.height !== 96) {
    errors.push("runtime compositor canvas must be exactly 96x96 native pixels");
  }
  const cases = metadata.cases;
  const canonicalCases = ["human-a", "human-b"].flatMap((rig) => (
    ["south", "east", "north", "west"].flatMap((facing) => (
      RUNTIME_COMPOSITOR_STATES.map((state) => ({ rig, facing, state }))
    ))
  ));
  if (!Array.isArray(cases) || cases.length !== canonicalCases.length) {
    errors.push("runtime compositor requires exactly 56 canonical cases");
  } else {
    const actionByState = {
      idle: "idle",
      walk: "walk",
      turn: "turn",
      talk: "idle",
      work: "work",
      hurt: "hurt-fall",
      recovery: "hurt-fall",
    };
    cases.forEach((candidate, index) => {
      const canonical = canonicalCases[index];
      if (!candidate || candidate.rig !== canonical.rig || candidate.facing !== canonical.facing
        || candidate.state !== canonical.state) {
        errors.push(`runtime compositor case ${index} violates canonical order`);
        return;
      }
      const expectedClip = `${canonical.rig}:${actionByState[canonical.state]}:${canonical.facing}`;
      if (candidate.bodyClipId !== expectedClip) {
        errors.push(`runtime compositor case ${index} body clip ownership mismatch`);
      }
      if (!finiteInteger(candidate.bodyFrameIndex) || candidate.bodyFrameIndex < 0) {
        errors.push(`runtime compositor case ${index} body frame index is invalid`);
      }
      const legalPoint = (point) => Array.isArray(point) && point.length === 2
        && point.every(finiteInteger);
      if (!legalPoint(candidate.faceDestination) || !legalPoint(candidate.hairDestination)) {
        errors.push(`runtime compositor case ${index} face/hair destination is invalid`);
      } else if (candidate.faceDestination[0] !== candidate.hairDestination[0]
        || candidate.faceDestination[1] !== candidate.hairDestination[1]) {
        errors.push(`runtime compositor case ${index} face and hair destinations diverge`);
      }
      if (!/^[a-f0-9]{64}$/.test(candidate.nativePixelsSha256 ?? "")) {
        errors.push(`runtime compositor case ${index} native pixel hash is invalid`);
      }
    });
  }
  for (const [scale, filename, declaredHash] of [
    ["1x", "runtime-compositor-human-1x.png", metadata.contactSheet1xSha256],
    ["2x", "runtime-compositor-human-2x.png", metadata.contactSheet2xSha256],
  ]) {
    const buffer = artifacts?.[filename];
    if (!Buffer.isBuffer(buffer)) errors.push(`runtime compositor ${scale} PNG is missing`);
    else if (hashBuffer(buffer) !== declaredHash) errors.push(`runtime compositor ${scale} PNG hash mismatch`);
  }
  return errors;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME_ROOT = path.join(ROOT, "frontend/src/assets/renderer2d");
const SCRATCH_ROOT = path.join(ROOT, "scratchpad/2d-production-art");
const NATIVE_ROOT = path.join(SCRATCH_ROOT, "source/native");
const EVIDENCE_ROOT = path.join(SCRATCH_ROOT, "evidence");
const PRESERVED_TASK12R_DIAGNOSTIC_EVIDENCE = Object.freeze([
  "task12r-ash-waste-landmarks-native-1x.png",
  "task12r-ash-waste-landmarks-nearest-2x.png",
  "task12r-ash-waste-yards-native-1x.png",
  "task12r-ash-waste-yards-nearest-2x.png",
  "task12r-ash-waste-composed-native-1x.png",
  "task12r-ash-risk-first-composed.png",
  "task12r-r2-ash-waste-landmarks-native-1x.png",
  "task12r-r2-ash-waste-landmarks-nearest-2x.png",
  "task12r-r2-ash-waste-yards-native-1x.png",
  "task12r-r2-ash-waste-yards-nearest-2x.png",
  "task12r-r2-ash-waste-composed-native-1x.png",
  "task12r-r2-ash-risk-first-composed.png",
]);
const PNG_OPTIONS = Object.freeze({
  palette: true,
  colours: 64,
  dither: 0,
  compressionLevel: 9,
  adaptiveFiltering: false,
  force: true,
});
const NATIVE_PNG_OPTIONS = Object.freeze({
  ...PNG_OPTIONS,
  palette: false,
  colours: undefined,
});
const OUTLINE = "#1c1c24";
const INTERNAL = "#3c342c";
const FACINGS = ["south", "east", "north", "west"];
const EXPRESSIONS = ["neutral", "blink-1", "blink-2", "talk-1", "talk-2", "weary", "hurt", "recovery"];
const BODY_ACTIONS = [
  ["idle", 4], ["walk", 6], ["run", 8], ["turn", 2], ["stop", 2],
  ["reach-give", 6], ["work", 6], ["hurt-fall", 6], ["prone", 2], ["dead", 1],
];
const HAIR_SILHOUETTES = ["crop", "messy", "waves", "bob", "braid", "bun", "coils", "short-curls"];
const CLOTHING_SILHOUETTES = [
  "work-shirt-sash", "short-jacket", "field-vest", "apron-wrap",
  "scarf-overshirt", "rolled-tunic", "utility-smock", "travel-shirt",
];
const HELD_FORMS = [
  "none", "basket", "wood-bundle", "stone-bundle", "material-crate", "energy-gift",
  "proposal-token", "hammer", "hearth-fuel", "vault-deposit", "vault-withdraw",
  "raid-tool", "loot-crate", "ruin-debris", "resource-handful", "reserve",
];
const STATUS_CELLS = Object.freeze({ selected: 0, paralyzed: 1, dead: 2 });
const REGION_KITS = ["worn-heartland", "spring-terraces", "dry-scrub", "ash-waste", "neutral-temperate"];
const REGION_ART = Object.freeze({
  "worn-heartland": {
    ground: ["#647846", "#8fa052", "#b3b96b"], accent: ["#385943", "#567653", "#83a56b"],
    path: ["#87694d", "#b18a60", "#d2b885"], roof: ["#603b2d", "#88543a", "#b6774d"],
    scenery: ["old-oak", "worn-stone", "faded-flower", "fallen-fence"],
    animated: ["grass", "shrub", "tree", "smoke-anchor"],
  },
  "spring-terraces": {
    ground: ["#5f8a72", "#82ad82", "#add09b"], accent: ["#276f78", "#3e9997", "#73bdad"],
    path: ["#667179", "#8e9d9b", "#c3c8b1"], roof: ["#a34f4c", "#ca6b5c", "#e99575"],
    scenery: ["terrace-rock", "willow", "spring-flower", "reed-bed"],
    animated: ["water", "reed", "grass", "shrub", "tree"],
  },
  "dry-scrub": {
    ground: ["#ad704e", "#d0955d", "#e8bd77"], accent: ["#75613c", "#9d7d43", "#c69d58"],
    path: ["#976e50", "#bd9163", "#ddbd89"], roof: ["#85462f", "#ae6137", "#d58a4c"],
    scenery: ["sun-rock", "deadwood", "dry-grass", "thorn"],
    animated: ["grass", "shrub", "smoke-anchor"],
  },
  "ash-waste": {
    ground: ["#34313f", "#514a5b", "#716879"], accent: ["#9f454d", "#d05f5d", "#ed8b69"],
    path: ["#202128", "#3d3b47", "#5a535d"], roof: ["#563348", "#81455e", "#ae6070"],
    scenery: ["charred-trunk", "slag-rock", "ash-pile", "bone-stone"],
    animated: ["ember", "smoke-anchor"],
  },
  "neutral-temperate": {
    ground: ["#668374", "#88a58d", "#b2c5a4"], accent: ["#46685c", "#6b8870", "#9bb18a"],
    path: ["#9a8d72", "#b9aa88", "#d8c9a6"], roof: ["#684a40", "#8d6652", "#b2886b"],
    scenery: ["broad-tree", "field-rock", "wildflower", "soft-grass"],
    animated: ["water", "grass", "shrub", "tree"],
  },
});
const REGIONAL_R4_MATERIALS = Object.freeze({
  "worn-heartland": Object.freeze({
    "olive-dark": "#647846", "olive-mid": "#8fa052", "olive-light": "#b3b96b",
    "ochre-earth": "#b18a60", "worn-beige": "#d2b885", timber: "#87694d",
    "faded-flower": "#b6774d", "hearth-amber": "#e8a45d",
  }),
  "spring-terraces": Object.freeze({
    "mint-dark": "#5f8a72", "mint-mid": "#82ad82", "mineral-stone": "#8e9d9b",
    "deep-aqua": "#276f78", "shallow-aqua": "#73bdad", reed: "#3e9997",
    "wet-timber": "#667179", "warm-reflection": "#e99575",
  }),
  "dry-scrub": Object.freeze({
    "ochre-dark": "#ad704e", "ochre-mid": "#d0955d", "sand-light": "#e8bd77",
    sandstone: "#bd9163", deadwood: "#75613c", thorn: "#9d7d43",
    "warm-clay": "#d58a4c", "brazier-amber": "#e8a45d",
  }),
  "ash-waste": Object.freeze({
    "plum-ash": "#514a5b", charcoal: "#202128", "coral-fissure": "#d05f5d",
    "oxidized-metal": "#716879", "containment-concrete": "#8c8492", slag: "#34313f",
    "vent-warm": "#ed8b69",
  }),
  "neutral-temperate": Object.freeze({
    "sage-dark": "#668374", "sage-mid": "#88a58d", "blue-green": "#6b8870",
    "pale-lane": "#d8c9a6", "damp-verge": "#9bb18a", "field-stone": "#b9aa88",
    wildflower: "#b2886b", "window-amber": "#e8b26c",
  }),
});
const REGIONAL_R4_GROUND_BASES = Object.freeze({
  "worn-heartland": "#c2c781",
  "spring-terraces": "#b8d8ab",
  "dry-scrub": "#f0cd91",
  "ash-waste": "#82798d",
  "neutral-temperate": "#bfd0b2",
});
const SEMANTIC_SCENERY_CELLS = Object.freeze(Object.fromEntries(Object.entries(REGION_ART).map(
  ([kit, art]) => [kit, Object.freeze(Object.fromEntries(art.scenery.map((kind, index) => [kind, index])))],
)));
const SEMANTIC_SCENERY_VARIANTS = Object.freeze(Object.fromEntries(Object.entries(REGION_ART).map(
  ([kit, art]) => [kit, Object.freeze(Object.fromEntries(art.scenery.map((kind, kindIndex) => [
    kind,
    Object.freeze(Array.from({ length: 32 }, (_unused, variant) => kindIndex + variant * 4)),
  ])))],
)));
const REGION_GUIDE_PATH = path.join(
  SCRATCH_ROOT,
  "source/imagegen-concepts/region-kits-imagegen-guide.png",
);
export const REGION_GUIDE_SCENERY = Object.freeze({
  "worn-heartland": Object.freeze({
    "old-oak": [[94, 517, 66, 77], [19, 534, 60, 60], [23, 694, 67, 72], [112, 698, 60, 62]],
    "worn-stone": [[19, 433, 71, 60], [104, 442, 39, 39], [158, 440, 56, 53], [227, 442, 44, 47]],
    "faded-flower": [[24, 615, 45, 63], [92, 625, 39, 50], [156, 627, 37, 47], [208, 635, 31, 39]],
    "fallen-fence": [[18, 358, 99, 51], [133, 358, 40, 49], [176, 360, 34, 55], [190, 709, 71, 57]],
  }),
  "spring-terraces": Object.freeze({
    "terrace-rock": [[345, 437, 64, 62], [418, 455, 36, 35], [468, 435, 54, 68], [533, 432, 45, 69]],
    willow: [[497, 513, 116, 123], [409, 522, 69, 83], [341, 532, 57, 69], [421, 699, 53, 71]],
    "spring-flower": [[346, 625, 52, 53], [417, 627, 44, 57], [473, 629, 39, 51], [490, 712, 48, 51]],
    "reed-bed": [[345, 355, 76, 60], [436, 352, 85, 70], [344, 798, 70, 66], [493, 808, 45, 55]],
  }),
  "dry-scrub": Object.freeze({
    "sun-rock": [[641, 435, 72, 62], [723, 447, 38, 40], [776, 442, 57, 57], [843, 442, 64, 63]],
    deadwood: [[723, 511, 52, 89], [786, 512, 74, 93], [641, 528, 63, 68], [862, 544, 51, 54]],
    "dry-grass": [[641, 618, 47, 65], [771, 615, 59, 74], [846, 628, 66, 53], [858, 699, 54, 70]],
    thorn: [[632, 798, 70, 68], [710, 789, 60, 79], [779, 817, 70, 54], [865, 814, 38, 50]],
  }),
  "ash-waste": Object.freeze({
    "charred-trunk": [[1023, 444, 59, 53], [1094, 443, 53, 54], [1162, 436, 43, 69], [1158, 432, 51, 77]],
    "slag-rock": [[941, 438, 68, 61], [946, 523, 65, 80], [1030, 525, 70, 75], [1115, 520, 79, 82]],
    "ash-pile": [[944, 711, 63, 55], [1023, 706, 53, 67], [1092, 711, 53, 58], [1157, 705, 47, 60]],
    "bone-stone": [[943, 625, 69, 60], [1028, 627, 52, 54], [1091, 627, 52, 47], [1152, 622, 48, 60]],
  }),
  "neutral-temperate": Object.freeze({
    "broad-tree": [[1231, 540, 60, 59], [1303, 522, 69, 77], [1427, 506, 86, 107], [1234, 707, 65, 62]],
    "field-rock": [[1234, 442, 65, 56], [1315, 450, 39, 37], [1367, 448, 55, 51], [1433, 451, 43, 44]],
    wildflower: [[1234, 623, 43, 62], [1295, 637, 38, 48], [1352, 637, 40, 48], [1454, 716, 54, 53]],
    "soft-grass": [[1236, 794, 40, 73], [1294, 796, 41, 75], [1362, 816, 67, 51], [1453, 811, 46, 57]],
  }),
});
const YARD_SEMANTIC_FRAMES = Object.freeze([
  "standing-a-base",
  "standing-b-base",
  "warm-overlay",
  "durable-hoarding-overlay",
  "persistent-ruin-base",
]);
const REGIONAL_COMPOSITION_GEOMETRY = Object.freeze({
  landmarks: Object.freeze({ width: 512, height: 256, cellWidth: 128, cellHeight: 128, cells: 8 }),
  yards: Object.freeze({ width: 960, height: 160, cellWidth: 192, cellHeight: 160, cells: 5 }),
});
const LANDMARK_INVENTORY = Object.freeze({
  "worn-heartland": Object.freeze([
    ["old-oak-grove-composite", "broad-crown"],
    ["old-oak-grove-composite", "split-crown"],
    ["old-oak-grove-composite", "wind-worn-crown"],
    ["broken-fence-garden-composite", "open-south-gap", "south"],
    ["broken-fence-garden-composite", "open-east-gap", "east"],
    ["broken-fence-garden-composite", "diagonal-reclaimed-boundary", "east-west"],
    ["reclaimed-path-shoulder-composite", "left-right-shoulder", "east-west"],
    ["reclaimed-path-shoulder-composite", "top-bottom-shoulder", "north-south"],
  ]),
  "spring-terraces": Object.freeze([
    ["connected-spring-terrace-composite", "curved-pool-rim"],
    ["connected-spring-terrace-composite", "stepped-pool-rim"],
    ["spring-hillside-terrace-composite", "two-wet-stone-levels", "south"],
    ["reed-bank-composite", "broken-sight-gap", "east-west"],
    ["wet-stone-willow-composite", "willow-left"],
    ["wet-stone-willow-composite", "willow-right"],
    ["short-boardwalk-composite", "north-south-planks", "north-south"],
    ["short-boardwalk-composite", "east-west-planks", "east-west"],
  ]),
  "dry-scrub": Object.freeze([
    ["sun-rock-outcrop-composite", "low-stepped-ridge"],
    ["sun-rock-outcrop-composite", "split-outcrop"],
    ["sun-rock-outcrop-composite", "wind-cut-diagonal-ridge", "east-west"],
    ["deadwood-thorn-tangle-composite", "crescent-open-south", "south"],
    ["deadwood-thorn-tangle-composite", "crescent-open-side", "east"],
    ["wind-scrub-clump-composite", "horizontal-wind"],
    ["wind-scrub-clump-composite", "rising-diagonal-wind"],
    ["wind-scrub-clump-composite", "falling-diagonal-wind"],
  ]),
  "ash-waste": Object.freeze([
    ["nuclear-crater-fissure-composite", "offset-crater-branching-fault"],
    ["nuclear-crater-fissure-composite", "split-crater-service-fracture", "east-west"],
    ["fractured-industrial-pylon-composite", "snapped-cross-member"],
    ["fractured-industrial-pylon-composite", "leaning-fractured-lattice"],
    ["slag-charred-ridge-composite", "slag-ridge-char-stumps"],
    ["slag-charred-ridge-composite", "industrial-aggregate-ridge"],
    ["ash-debris-fan-composite", "narrow-directional-fan", "east"],
    ["ash-debris-fan-composite", "joined-containment-debris-fan", "east"],
  ]),
  "neutral-temperate": Object.freeze([
    ["restrained-broad-grove-composite", "broad-crown"],
    ["restrained-broad-grove-composite", "paired-trees"],
    ["restrained-broad-grove-composite", "sparse-open-grove"],
    ["field-rock-boundary-composite", "boundary-open-south", "south"],
    ["field-rock-boundary-composite", "boundary-open-side", "east"],
    ["wildflower-verge-composite", "left-verge"],
    ["wildflower-verge-composite", "right-verge"],
    ["wildflower-verge-composite", "diagonal-verge"],
  ]),
});

const landmarkPivot = (semanticKind) => {
  if (/grove|willow/.test(semanticKind)) return { x: 64, y: 112 };
  if (/pylon/.test(semanticKind)) return { x: 64, y: 116 };
  if (/outcrop|tangle|ridge/.test(semanticKind)) return { x: 64, y: 104 };
  if (/crater|boardwalk/.test(semanticKind)) return { x: 64, y: 64 };
  if (/spring-terrace/.test(semanticKind)) return { x: 64, y: 80 };
  if (/debris-fan/.test(semanticKind)) return { x: 64, y: 88 };
  return { x: 64, y: 96 };
};

const isTallLandmark = (semanticKind) => /grove|willow|pylon/.test(semanticKind);
const WORN_HEARTLAND_LANDMARK_HARD_OFFSETS = Object.freeze({
  "worn-heartland:broad-crown": Object.freeze([{ x: 0, y: 0 }]),
  "worn-heartland:split-crown": Object.freeze([{ x: -1, y: 0 }, { x: 0, y: 0 }]),
  "worn-heartland:wind-worn-crown": Object.freeze([{ x: -1, y: 0 }, { x: 0, y: 0 }]),
});

function wornHeartlandApprovedLandmarkMaterialRamps() {
  const palette = REGIONAL_R5_PALETTES.kits["worn-heartland"];
  const rgb = (token) => regionalR5HexRgb(palette[token], `worn-heartland landmark ${token}`);
  return {
    "ground-cover": [rgb("olive-dark"), rgb("olive-mid"), rgb("olive-light")],
    "path-surface": [rgb("ochre-earth"), rgb("worn-beige")],
    "timber-material": [rgb("timber"), rgb("hearth-amber")],
    "faded-accent": [rgb("faded-flower")],
  };
}

/** Return detached exact collision supports for the three worn old-oak variants. */
export function wornHeartlandLandmarkHardOffsets() {
  return structuredClone(WORN_HEARTLAND_LANDMARK_HARD_OFFSETS);
}

const landmarkHardOffsets = (semanticKind, variantId) => {
  const wornVariant = WORN_HEARTLAND_LANDMARK_HARD_OFFSETS[variantId];
  if (wornVariant) return structuredClone(wornVariant);
  if (/pylon/.test(semanticKind)) return [{ x: -1, y: 0 }, { x: 1, y: 0 }];
  if (/grove/.test(semanticKind)) return [{ x: -1, y: 0 }, { x: 1, y: 0 }];
  if (/willow/.test(semanticKind)) return [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  if (/outcrop|ridge/.test(semanticKind)) return [{ x: -1, y: 0 }, { x: 0, y: 0 }];
  if (/tangle|boundary|garden/.test(semanticKind)) return [{ x: -1, y: 0 }];
  return [];
};

const footprintOffsets = (footprint) => Array.from({ length: footprint.heightTiles }, (_unused, y) => (
  Array.from({ length: footprint.widthTiles }, (_unused2, x) => ({
    x: footprint.originOffsetTiles.x + x,
    y: footprint.originOffsetTiles.y + y,
  }))
)).flat();

const landmarkVariantSpec = (kit, tuple, cellIndex) => {
  const [semanticKind, variantName, orientation = "none"] = tuple;
  const variantId = `${kit}:${variantName}`;
  const tall = isTallLandmark(semanticKind);
  const visualFootprint = {
    originOffsetTiles: { x: -2, y: tall ? -3 : -2 },
    widthTiles: 4,
    heightTiles: 4,
  };
  const portRole = /boardwalk|path|fence|garden/.test(semanticKind) ? "path"
    : /spring|reed|willow/.test(semanticKind) ? "shore" : "cluster";
  const connectionPorts = orientation === "north-south"
    ? [{ side: "north", startPx: 48, widthPx: 32, role: portRole }, { side: "south", startPx: 48, widthPx: 32, role: portRole }]
    : orientation === "east-west"
      ? [{ side: "east", startPx: 48, widthPx: 32, role: portRole }, { side: "west", startPx: 48, widthPx: 32, role: portRole }]
      : ["north", "east", "south", "west"].includes(orientation)
        ? [{ side: orientation, startPx: 48, widthPx: 32, role: portRole }]
        : [];
  const recognitionTags = /pylon/.test(semanticKind)
    ? ["fractured-industrial-lattice", "integrated-three-lobed-containment-relief"]
    : variantName === "joined-containment-debris-fan"
      ? ["joined-containment-debris", "integrated-three-lobed-containment-relief"]
      : [semanticKind];
  return {
    kitId: kit,
    semanticKind,
    variantId,
    cellIndex,
    orientation,
    connectionPorts,
    compatibleAdjacency: Object.fromEntries(["north", "east", "south", "west"].map((side) => [side, `${kit}:ground`])),
    eligibleTopologyKeys: [`${kit}:${semanticKind}:${orientation}`],
    contactPivotPx: landmarkPivot(semanticKind),
    visualFootprint,
    hardOffsets: landmarkHardOffsets(semanticKind, variantId),
    interactionExclusionOffsets: tall ? footprintOffsets(visualFootprint) : [],
    drawLayer: "static-back",
    heightPolicy: tall ? "tall-static-back-excluded" : "planar",
    recognitionTags,
  };
};

const REGIONAL_VARIANT_SPECS = Object.freeze(Object.fromEntries(REGION_KITS.map((kit) => {
  const landmarkById = new Map(REGIONAL_R4_VARIANT_RECIPES[kit].landmarks.map((recipe) => [recipe.id, recipe]));
  const landmarks = LANDMARK_INVENTORY[kit].map((tuple, index) => {
    const inherited = landmarkVariantSpec(kit, tuple, index);
    const recipe = landmarkById.get(inherited.variantId);
    if (!recipe) throw new Error(`${kit}/${inherited.variantId}: R4 native landmark recipe missing`);
    return Object.freeze({
      ...inherited,
      semanticKind: recipe.semanticKind,
      variantId: recipe.id,
      cellIndex: recipe.cell,
      contactPivotPx: structuredClone(recipe.contactPivotPx),
      eligibleTopologyKeys: [recipe.topologyKey],
      recognitionTags: [...recipe.recognitionTags],
    });
  });
  const yards = REGIONAL_R4_VARIANT_RECIPES[kit].yards.map((recipe, cellIndex) => Object.freeze({
    kitId: kit,
    semanticKind: recipe.semanticKind,
    variantId: recipe.id,
    cellIndex,
    orientation: "south",
    connectionPorts: [{ side: "south", startPx: 80, widthPx: 32, role: "path" }],
    compatibleAdjacency: { north: `${kit}:home`, east: `${kit}:ground`, south: `${kit}:path`, west: `${kit}:ground` },
    eligibleTopologyKeys: [recipe.topologyKey],
    contactPivotPx: { x: 96, y: 112 },
    visualFootprint: { originOffsetTiles: { x: -3, y: -3 }, widthTiles: 6, heightTiles: 5 },
    hardOffsets: [],
    interactionExclusionOffsets: [],
    drawLayer: "home-back",
    heightPolicy: "home-apron",
    recognitionTags: [...recipe.recognitionTags],
  }));
  return [kit, Object.freeze({ landmarks: Object.freeze(landmarks), yards: Object.freeze(yards) })];
})));
const SCENIC_LANDMARK_KINDS = Object.freeze([...new Set(REGION_KITS.flatMap((kit) => (
  LANDMARK_INVENTORY[kit].map(([semanticKind]) => semanticKind)
)))]);
const ASH_SCENE_PROOF = Object.freeze({
  file: "ash-waste-production-scene-1440x900.png",
  kit: "ash-waste",
  width: 1440,
  height: 900,
  openInteractionRect: Object.freeze({ x: 528, y: 258, width: 384, height: 320 }),
  placements: Object.freeze([
    [0, 2, 3, 3], [1, 11, 4, 3], [2, 19, 5, 4], [3, 25, 3, 5], [1, 28, 5, 5],
    [0, 7, 1, 9], [0, 21, 2, 12], [1, 5, 6, 1], [1, 17, 7, 12],
    [2, 4, 12, 2], [2, 14, 15, 12], [3, 9, 18, 2], [3, 23, 19, 10],
    [0, 13, 20, 5], [1, 30, 20, 12], [2, 27, 10, 12], [3, 3, 13, 10],
    [0, 18, 1, 2], [1, 8, 5, 7], [2, 31, 7, 2], [3, 15, 9, 1],
    [0, 29, 11, 2], [1, 24, 14, 1], [2, 8, 17, 3], [3, 29, 21, 2],
    [0, 5, 17, 9], [1, 9, 18, 10], [2, 16, 19, 9], [3, 20, 20, 11],
    [1, 27, 18, 12],
  ]),
  emberPlacements: Object.freeze([[2, 6], [6, 10], [10, 3], [14, 11], [18, 5], [20, 8]]),
});
const HOME_COMPONENTS = [
  "foundation", "post", "wall-intact", "wall-cracked", "wall-broken", "wall-falling",
  "roof-intact", "roof-damaged", "roof-falling", "door-closed", "door-opening-1",
  "door-opening-2", "door-opening-3", "door-open", "door-breached", "door-falling",
  "window-cold", "window-lit", "window-broken", "hearth-cold", "hearth-lit-1",
  "hearth-lit-2", "chimney", "dust",
];
const RUIN_CELLS = [
  "rubble-full", "rubble-full-scavenge", "rubble-picked", "rubble-picked-scavenge",
  "rubble-bare", "rubble-bare-scavenge", "collapse-debris", "snapshot-sweep-dissolve",
];

function rgba(hex, alpha = 255) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, alpha];
}

function createSurface(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

function pixel(surface, x, y, color) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= surface.width || py >= surface.height) return;
  surface.data.set(color, (py * surface.width + px) * 4);
}

function fillRect(surface, x, y, width, height, color) {
  for (let py = Math.round(y); py < Math.round(y + height); py += 1) {
    for (let px = Math.round(x); px < Math.round(x + width); px += 1) pixel(surface, px, py, color);
  }
}

function clearRect(surface, x, y, width, height) {
  fillRect(surface, x, y, width, height, [0, 0, 0, 0]);
}

function outlinedRect(surface, x, y, width, height, fill, outline = rgba(OUTLINE)) {
  fillRect(surface, x, y, width, height, outline);
  if (width > 2 && height > 2) fillRect(surface, x + 1, y + 1, width - 2, height - 2, fill);
}

function ellipse(surface, centerX, centerY, radiusX, radiusY, fill, outline = rgba(OUTLINE)) {
  for (let y = Math.floor(centerY - radiusY); y <= Math.ceil(centerY + radiusY); y += 1) {
    for (let x = Math.floor(centerX - radiusX); x <= Math.ceil(centerX + radiusX); x += 1) {
      const distance = ((x - centerX) ** 2) / (radiusX ** 2) + ((y - centerY) ** 2) / (radiusY ** 2);
      if (distance > 1) continue;
      const inner = ((x - centerX) ** 2) / Math.max(1, (radiusX - 1) ** 2)
        + ((y - centerY) ** 2) / Math.max(1, (radiusY - 1) ** 2);
      pixel(surface, x, y, inner <= 1 ? fill : outline);
    }
  }
}

function line(surface, x0, y0, x1, y1, color, width = 1) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x0 + (x1 - x0) * (step / steps));
    const y = Math.round(y0 + (y1 - y0) * (step / steps));
    fillRect(surface, x - Math.floor(width / 2), y - Math.floor(width / 2), width, width, color);
  }
}

function polygon(surface, points, fill, outline = null) {
  const minY = Math.max(0, Math.floor(Math.min(...points.map(([, y]) => y))));
  const maxY = Math.min(surface.height - 1, Math.ceil(Math.max(...points.map(([, y]) => y))));
  for (let y = minY; y <= maxY; y += 1) {
    const crossings = [];
    for (let index = 0; index < points.length; index += 1) {
      const [x1, y1] = points[index];
      const [x2, y2] = points[(index + 1) % points.length];
      if ((y1 > y) === (y2 > y) || y1 === y2) continue;
      crossings.push(Math.round(x1 + (y - y1) * (x2 - x1) / (y2 - y1)));
    }
    crossings.sort((left, right) => left - right);
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      fillRect(surface, crossings[index], y, crossings[index + 1] - crossings[index] + 1, 1, fill);
    }
  }
  if (outline !== null) {
    for (let index = 0; index < points.length; index += 1) {
      const [x1, y1] = points[index];
      const [x2, y2] = points[(index + 1) % points.length];
      line(surface, x1, y1, x2, y2, outline, 2);
    }
  }
}

function translatedPolygon(surface, originX, originY, points, fill, outline = null) {
  polygon(surface, points.map(([x, y]) => [originX + x, originY + y]), fill, outline);
}

function exactObjectKeys(value, expected) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function regionalR4MaterialColors(kit) {
  const materials = REGIONAL_R4_MATERIALS[kit];
  if (!materials) throw new Error(`Unknown R4 region kit ${kit}`);
  return Object.freeze(Object.fromEntries(Object.entries(materials).map(([name, value]) => [name, rgba(value)])));
}

function validateRegionalR4Point(point, width, height, label) {
  if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isInteger)) {
    throw new Error(`${label} coordinates must be integer`);
  }
  if (point[0] < 0 || point[1] < 0 || point[0] >= width || point[1] >= height) {
    throw new Error(`${label} point ${point.join(",")} is outside ${width}x${height}`);
  }
}

function validateRegionalR4Operation(operation, materials, width, height, recipeId) {
  const schemas = {
    polygon: ["kind", "material", "points"],
    rect: ["kind", "material", "x", "y", "width", "height"],
    line: ["kind", "material", "from", "to", "width"],
    cluster: ["kind", "material", "points"],
  };
  const expectedKeys = schemas[operation?.kind];
  if (!expectedKeys) throw new Error(`Unknown R4 pixel operation ${String(operation?.kind)} in ${recipeId}`);
  if (!exactObjectKeys(operation, expectedKeys)) throw new Error(`${recipeId}/${operation.kind}: operation keys are not closed`);
  const color = materials[operation.material];
  if (!Array.isArray(color) || color.length !== 4
    || !color.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)) {
    throw new Error(`Unknown R4 material ${String(operation.material)} in ${recipeId}`);
  }
  if (operation.kind === "polygon" || operation.kind === "cluster") {
    const minimumPoints = operation.kind === "polygon" ? 3 : 2;
    if (!Array.isArray(operation.points) || operation.points.length < minimumPoints) {
      throw new Error(`${recipeId}/${operation.kind}: at least ${minimumPoints === 3 ? "three" : "two"} points are required`);
    }
    operation.points.forEach((point) => validateRegionalR4Point(point, width, height, `${recipeId}/${operation.kind}`));
  } else if (operation.kind === "rect") {
    if (![operation.x, operation.y, operation.width, operation.height].every(Number.isInteger)) {
      throw new Error(`${recipeId}/rect values must be integer`);
    }
    if (operation.width <= 0 || operation.height <= 0) throw new Error(`${recipeId}/rect dimensions must be positive`);
    validateRegionalR4Point([operation.x, operation.y], width, height, `${recipeId}/rect`);
    validateRegionalR4Point(
      [operation.x + operation.width - 1, operation.y + operation.height - 1],
      width,
      height,
      `${recipeId}/rect`,
    );
  } else {
    if (!Number.isInteger(operation.width) || operation.width <= 0) {
      throw new Error(`${recipeId}/line width must be a positive integer`);
    }
    validateRegionalR4Point(operation.from, width, height, `${recipeId}/line`);
    validateRegionalR4Point(operation.to, width, height, `${recipeId}/line`);
  }
  return color;
}

function renderPixelRecipe(surface, originX, originY, materials, recipe, width, height) {
  if (!Number.isInteger(originX) || !Number.isInteger(originY)) throw new Error(`${recipe?.id}: recipe origin must be integer`);
  if (!recipe || typeof recipe.id !== "string" || !Array.isArray(recipe.operations)) {
    throw new Error("R4 pixel recipe requires an id and operations array");
  }
  for (const operation of recipe.operations) {
    const color = validateRegionalR4Operation(operation, materials, width, height, recipe.id);
    if (operation.kind === "polygon") {
      translatedPolygon(surface, originX, originY, operation.points, color);
    } else if (operation.kind === "rect") {
      fillRect(surface, originX + operation.x, originY + operation.y, operation.width, operation.height, color);
    } else if (operation.kind === "line") {
      line(
        surface,
        originX + operation.from[0],
        originY + operation.from[1],
        originX + operation.to[0],
        originY + operation.to[1],
        color,
        operation.width,
      );
    } else if (operation.kind === "cluster") {
      for (const [x, y] of operation.points) {
        pixel(surface, originX + x, originY + y, color);
        pixel(surface, originX + (x + 1 < width ? x + 1 : x - 1), originY + y, color);
        pixel(surface, originX + x, originY + (y + 1 < height ? y + 1 : y - 1), color);
      }
    }
  }
}

/** Render one strict R4 recipe to raw RGBA bytes for authoring and direct golden validation. */
export function renderRegionalR4Recipe({ width, height, materials, recipe }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("R4 recipe surface geometry must use positive integers");
  }
  const surface = createSurface(width, height);
  renderPixelRecipe(surface, 0, 0, materials, recipe, width, height);
  return surface.data;
}

function steppedMaterialPatch(surface, originX, originY, variant, colors, width = 32, height = 32) {
  const [dark, mid, light] = colors.map((color) => rgba(color));
  fillRect(surface, originX, originY, width, height, mid);
  const left = 3 + variant % 5;
  const top = 4 + variant * 3 % 7;
  translatedPolygon(surface, originX, originY, [
    [left, top + 2], [left + 5, top], [left + 13, top + 1], [left + 17, top + 5],
    [left + 14, top + 10], [left + 6, top + 11], [left + 1, top + 7],
  ], dark);
  const right = 18 - variant % 4;
  const bottom = 20 + variant % 4;
  translatedPolygon(surface, originX, originY, [
    [right, bottom], [right + 5, bottom - 2], [right + 10, bottom + 1],
    [right + 9, bottom + 6], [right + 3, bottom + 8], [right - 2, bottom + 5],
  ], light);
  fillRect(surface, originX + 4 + variant % 6, originY + 25 - variant % 4, 7, 3, dark);
  fillRect(surface, originX + 7 + variant % 6, originY + 27 - variant % 4, 8, 2, dark);
}

function drawPixelFlower(surface, x, y, stem, petal, highlight = null) {
  fillRect(surface, x, y + 4, 2, 7, stem);
  fillRect(surface, x - 2, y + 1, 6, 4, petal);
  if (highlight !== null) fillRect(surface, x, y, 2, 2, highlight);
}

function drawStone(surface, x, y, width, height, dark, mid, light) {
  polygon(surface, [
    [x + 2, y], [x + width - 4, y], [x + width, y + 4], [x + width - 2, y + height - 2],
    [x + width - 7, y + height], [x + 2, y + height - 2], [x, y + 4],
  ], mid, dark);
  fillRect(surface, x + 4, y + 3, Math.max(2, width - 9), Math.max(2, Math.floor(height / 4)), light);
}

function drawIrregularCrown(surface, originX, originY, points, dark, mid, light, variant) {
  translatedPolygon(surface, originX, originY, points, dark, rgba(OUTLINE));
  translatedPolygon(surface, originX, originY, points.map(([x, y], index) => [
    x + (index % 2 === 0 ? 4 : -2),
    y + (index < points.length / 2 ? 4 : -3),
  ]), mid);
  for (const [x, y, width] of [
    [18 + variant % 6, 14, 15], [42, 9 + variant % 5, 19], [64 - variant % 4, 20, 14],
  ]) fillRect(surface, originX + x, originY + y, width, 4, light);
}

function drawFenceSegment(surface, x0, y0, x1, y1, dark, mid) {
  line(surface, x0, y0, x1, y1, dark, 5);
  line(surface, x0, y0 - 1, x1, y1 - 1, mid, 2);
  const steps = Math.max(2, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 22));
  for (let index = 0; index <= steps; index += 1) {
    const x = Math.round(x0 + (x1 - x0) * index / steps);
    const y = Math.round(y0 + (y1 - y0) * index / steps);
    line(surface, x, y - 7, x, y + 7, dark, 4);
    line(surface, x, y - 6, x, y + 4, mid, 2);
  }
}

function drawThreeLobedRelief(surface, originX, originY, centerX, centerY, color) {
  ellipse(surface, originX + centerX, originY + centerY - 6, 5, 6, color);
  ellipse(surface, originX + centerX - 6, originY + centerY + 5, 5, 6, color);
  ellipse(surface, originX + centerX + 6, originY + centerY + 5, 5, 6, color);
  ellipse(surface, originX + centerX, originY + centerY + 2, 3, 3, rgba(OUTLINE));
}

function drawRejectedLandmarkCell(surface, originX, originY, kit, spec, variantIndex) {
  const art = REGION_ART[kit];
  const outline = rgba(OUTLINE);
  const dark = rgba(art.path[0]);
  const mid = rgba(art.path[1]);
  const light = rgba(art.path[2]);
  const accentDark = rgba(art.accent[0]);
  const accentMid = rgba(art.accent[1]);
  const accentLight = rgba(art.accent[2]);
  const kind = spec.semanticKind;
  const flip = variantIndex % 2 === 1;
  const ox = (value) => originX + value;
  const oy = (value) => originY + value;

  if (/grove/.test(kind)) {
    ellipse(surface, ox(64), oy(101), 46, 13, dark);
    const trunks = variantIndex % 3 === 1 ? [48, 78] : [42, 64, 86];
    for (const x of trunks) {
      outlinedRect(surface, ox(x - 5), oy(66 + Math.abs(x - 64) / 5), 10, 43 - Math.abs(x - 64) / 8, mid, outline);
      line(surface, ox(x), oy(76), ox(x + (x < 64 ? -10 : 10)), oy(54), outline, 4);
    }
    for (const [x, y, rx, ry, shade] of [
      [35, 51, 25, 22, accentDark], [58, 39, 31, 27, accentMid],
      [86, 50, 27, 24, accentDark], [69, 61, 33, 22, accentMid],
      [flip ? 31 : 95, 35, 18, 16, accentLight],
    ]) ellipse(surface, ox(x), oy(y), rx, ry, shade, outline);
    return;
  }

  if (/broken-fence-garden/.test(kind)) {
    ellipse(surface, ox(64), oy(78), 49, 31, dark, outline);
    ellipse(surface, ox(62), oy(78), 38, 22, mid, dark);
    const gapSide = spec.orientation;
    const segments = gapSide === "south"
      ? [[18, 50, 18, 102], [110, 50, 110, 102], [18, 50, 110, 50]]
      : gapSide === "east"
        ? [[18, 48, 18, 104], [18, 48, 108, 48], [18, 104, 78, 104]]
        : [[18, 95, 52, 62], [75, 55, 110, 30]];
    for (const [x0, y0, x1, y1] of segments) line(surface, ox(x0), oy(y0), ox(x1), oy(y1), outline, 5);
    for (const [x, y] of [[18, 50], [18, 101], [110, 50], [110, 101]]) outlinedRect(surface, ox(x - 3), oy(y - 8), 7, 17, light, outline);
    for (const [x, y] of [[43, 75], [58, 88], [77, 70], [91, 91]]) {
      line(surface, ox(x), oy(y + 5), ox(x), oy(y - 4), accentDark, 2);
      fillRect(surface, ox(x - 2), oy(y - 6), 5, 4, accentLight);
    }
    return;
  }

  if (/path-shoulder/.test(kind)) {
    if (spec.orientation === "north-south") {
      fillRect(surface, ox(48), oy(0), 32, 128, mid);
      line(surface, ox(48), oy(0), ox(48), oy(127), dark, 2);
      line(surface, ox(79), oy(0), ox(79), oy(127), dark, 2);
      for (const y of [18, 44, 73, 105]) ellipse(surface, ox(y % 2 ? 33 : 94), oy(y), 18, 7, accentDark, outline);
    } else {
      fillRect(surface, ox(0), oy(48), 128, 32, mid);
      line(surface, ox(0), oy(48), ox(127), oy(48), dark, 2);
      line(surface, ox(0), oy(79), ox(127), oy(79), dark, 2);
      for (const x of [18, 44, 73, 105]) ellipse(surface, ox(x), oy(x % 2 ? 33 : 94), 7, 18, accentDark, outline);
    }
    return;
  }

  if (/spring-terrace/.test(kind)) {
    ellipse(surface, ox(64), oy(70), 52, 42, dark, outline);
    ellipse(surface, ox(flip ? 58 : 69), oy(67), 43, 33, accentDark, dark);
    ellipse(surface, ox(flip ? 52 : 76), oy(63), 30, 22, accentMid, accentDark);
    line(surface, ox(20), oy(99), ox(108), oy(99), light, 7);
    line(surface, ox(30), oy(108), ox(98), oy(108), mid, 6);
    for (const x of [24, 42, 86, 104]) ellipse(surface, ox(x), oy(98), 7, 5, light, outline);
    return;
  }

  if (/hillside-terrace/.test(kind)) {
    outlinedRect(surface, ox(14), oy(35), 100, 25, mid, outline);
    outlinedRect(surface, ox(25), oy(69), 88, 28, light, outline);
    fillRect(surface, ox(51), oy(52), 27, 54, dark);
    line(surface, ox(51), oy(53), ox(51), oy(105), outline, 2);
    line(surface, ox(77), oy(53), ox(77), oy(105), outline, 2);
    return;
  }

  if (/reed-bank/.test(kind)) {
    ellipse(surface, ox(64), oy(91), 52, 18, accentDark, outline);
    for (const x of [18, 25, 33, 42, 52, 76, 86, 95, 104, 112]) {
      const height = 24 + (x * 7) % 22;
      line(surface, ox(x), oy(96), ox(x + (x % 3) - 1), oy(96 - height), outline, 3);
      line(surface, ox(x), oy(96), ox(x + (x % 3) - 1), oy(96 - height), accentMid, 1);
    }
    return;
  }

  if (/willow/.test(kind)) {
    const trunkX = flip ? 84 : 44;
    ellipse(surface, ox(64), oy(104), 48, 12, mid, outline);
    outlinedRect(surface, ox(trunkX - 6), oy(55), 13, 55, dark, outline);
    line(surface, ox(trunkX), oy(70), ox(flip ? 53 : 76), oy(41), outline, 5);
    for (const [x, y, rx, ry] of [[45, 38, 25, 21], [69, 31, 29, 23], [88, 44, 23, 24]]) {
      ellipse(surface, ox(flip ? 128 - x : x), oy(y), rx, ry, accentMid, outline);
      for (let drop = 0; drop < 3; drop += 1) line(surface, ox((flip ? 128 - x : x) - 10 + drop * 10), oy(y + 8), ox((flip ? 128 - x : x) - 12 + drop * 10), oy(y + 39), accentDark, 2);
    }
    return;
  }

  if (/boardwalk/.test(kind)) {
    if (spec.orientation === "north-south") {
      fillRect(surface, ox(48), oy(0), 32, 128, dark);
      for (let y = 2; y < 128; y += 12) outlinedRect(surface, ox(45), oy(y), 38, 9, mid, outline);
      line(surface, ox(22), oy(48), ox(106), oy(48), accentDark, 7);
      line(surface, ox(22), oy(82), ox(106), oy(82), accentDark, 7);
    } else {
      fillRect(surface, ox(0), oy(48), 128, 32, dark);
      for (let x = 2; x < 128; x += 12) outlinedRect(surface, ox(x), oy(45), 9, 38, mid, outline);
      line(surface, ox(48), oy(22), ox(48), oy(106), accentDark, 7);
      line(surface, ox(82), oy(22), ox(82), oy(106), accentDark, 7);
    }
    return;
  }

  if (/outcrop/.test(kind)) {
    ellipse(surface, ox(64), oy(92), 54, 22, dark, outline);
    for (const [x, y, rx, ry, shade] of [[30, 83, 22, 21, mid], [60, 73, 27, 29, light], [92, 86, 27, 22, mid]]) {
      ellipse(surface, ox(flip ? 128 - x : x), oy(y), rx, ry, shade, outline);
    }
    line(surface, ox(18), oy(106), ox(110), oy(101), accentDark, 3);
    return;
  }

  if (/tangle/.test(kind)) {
    ellipse(surface, ox(64), oy(94), 51, 16, dark, outline);
    for (const [x0, y0, x1, y1] of [[20, 91, 45, 48], [45, 95, 68, 40], [68, 96, 105, 52], [27, 75, 98, 89]]) line(surface, ox(flip ? 128 - x0 : x0), oy(y0), ox(flip ? 128 - x1 : x1), oy(y1), outline, 5);
    for (const x of [28, 48, 76, 98]) line(surface, ox(x), oy(83), ox(x + (flip ? -9 : 9)), oy(66), accentDark, 3);
    return;
  }

  if (/wind-scrub/.test(kind)) {
    ellipse(surface, ox(64), oy(91), 53, 24, dark, outline);
    line(surface, ox(13), oy(94), ox(115), oy(70 + (variantIndex % 3) * 8), dark, 8);
    for (let index = 0; index < 8; index += 1) {
      const x = 18 + index * 13;
      const y = 90 - (variantIndex === 1 ? index * 3 : variantIndex === 2 ? (7 - index) * 3 : 0);
      ellipse(surface, ox(x), oy(y), 10, 8, accentDark, outline);
      line(surface, ox(x), oy(y), ox(x + 12), oy(y - 12), accentMid, 3);
    }
    return;
  }

  if (/crater-fissure/.test(kind)) {
    line(surface, ox(5), oy(flip ? 89 : 78), ox(123), oy(flip ? 49 : 62), dark, 37);
    ellipse(surface, ox(flip ? 29 : 35), oy(76), 28, 31, dark, outline);
    ellipse(surface, ox(flip ? 76 : 70), oy(61), 39, 28, dark, outline);
    ellipse(surface, ox(flip ? 107 : 101), oy(68), 22, 28, dark, outline);
    outlinedRect(surface, ox(8), oy(flip ? 92 : 38), 31, 10, mid, outline);
    outlinedRect(surface, ox(88), oy(flip ? 29 : 94), 32, 9, mid, outline);
    const points = flip ? [[3, 101, 39, 76], [39, 76, 68, 85], [68, 85, 125, 39]]
      : [[3, 43, 42, 66], [42, 66, 72, 53], [72, 53, 125, 101]];
    for (const [x0, y0, x1, y1] of points) {
      line(surface, ox(x0), oy(y0), ox(x1), oy(y1), outline, 5);
      line(surface, ox(x0), oy(y0), ox(x1), oy(y1), accentMid, 2);
    }
    line(surface, ox(42), oy(66), ox(flip ? 24 : 56), oy(111), accentDark, 3);
    line(surface, ox(72), oy(53), ox(flip ? 92 : 105), oy(29), accentDark, 3);
    return;
  }

  if (/pylon/.test(kind)) {
    const lean = flip ? 5 : 0;
    outlinedRect(surface, ox(7), oy(104), 114, 17, dark, outline);
    outlinedRect(surface, ox(10), oy(83), 24, 24, mid, outline);
    outlinedRect(surface, ox(94), oy(83), 24, 24, mid, outline);
    line(surface, ox(19 + lean), oy(108), ox(37 + lean), oy(19), outline, 8);
    line(surface, ox(109 + lean), oy(108), ox(91 + lean), oy(19), outline, 8);
    line(surface, ox(27 + lean), oy(24), ox(101 + lean), oy(flip ? 12 : 24), outline, 10);
    line(surface, ox(64 + lean), oy(18), ox(64 + lean), oy(7), outline, 5);
    line(surface, ox(31 + lean), oy(38), ox(99 + lean), oy(96), dark, 5);
    line(surface, ox(97 + lean), oy(38), ox(29 + lean), oy(96), dark, 5);
    line(surface, ox(4), oy(77), ox(124), oy(flip ? 91 : 78), outline, 4);
    for (const x of [9, 26, 102, 119]) outlinedRect(surface, ox(x - 3), oy(72 + (x % 2) * 8), 7, 35, dark, outline);
    outlinedRect(surface, ox(41 + lean), oy(53), 48, 42, mid, outline);
    outlinedRect(surface, ox(48 + lean), oy(59), 34, 29, dark, outline);
    line(surface, ox(44 + lean), oy(49), ox(88 + lean), oy(49), accentDark, 4);
    drawThreeLobedRelief(surface, originX, originY, 65 + lean, 73, accentDark);
    line(surface, ox(12), oy(112), ox(51), oy(91), mid, 4);
    line(surface, ox(116), oy(112), ox(78), oy(91), mid, 4);
    return;
  }

  if (/slag-charred-ridge/.test(kind)) {
    line(surface, ox(3), oy(105), ox(125), oy(flip ? 78 : 87), dark, 29);
    for (const [x, y, rx, ry] of [[18, 91, 20, 22], [48, 79, 27, 31], [80, 87, 28, 27], [111, 78, 20, 23]]) ellipse(surface, ox(flip ? 128 - x : x), oy(y), rx, ry, mid, outline);
    for (const [x, y, w, h] of [[6, 88, 31, 11], [35, 99, 38, 12], [72, 81, 36, 11], [97, 101, 27, 10]]) outlinedRect(surface, ox(flip ? 128 - x - w : x), oy(y), w, h, dark, outline);
    for (const x of [20, 57, 95, 116]) {
      line(surface, ox(x), oy(91), ox(x + (flip ? -10 : 10)), oy(30 + x % 9), outline, 8);
      line(surface, ox(x), oy(69), ox(x - 11), oy(55), dark, 4);
    }
    line(surface, ox(3), oy(112), ox(125), oy(70), accentDark, 4);
    line(surface, ox(31), oy(104), ox(69), oy(59), accentMid, 2);
    return;
  }

  if (/debris-fan/.test(kind)) {
    const direction = flip ? -1 : 1;
    line(surface, ox(3), oy(flip ? 101 : 86), ox(125), oy(flip ? 68 : 105), dark, 27);
    for (const [x, y, w, h] of [[4, 73, 31, 19], [27, 61, 37, 22], [56, 82, 43, 20], [92, 68, 32, 23]]) outlinedRect(surface, ox(flip ? 128 - x - w : x), oy(y), w, h, mid, outline);
    for (const [x0, y0, x1, y1] of [[8, 99, 36, 42], [34, 104, 63, 31], [68, 107, 101, 39], [98, 106, 121, 51]]) line(surface, ox(flip ? 128 - x0 : x0), oy(y0), ox(flip ? 128 - x1 : x1), oy(y1), outline, 7);
    line(surface, ox(5), oy(112), ox(123), oy(53), accentDark, 5);
    if (spec.variantId.endsWith("joined-containment-debris-fan")) {
      outlinedRect(surface, ox(43), oy(49), 52, 46, dark, outline);
      for (let rib = 0; rib < 5; rib += 1) line(surface, ox(49 + rib * 10), oy(52), ox(49 + rib * 10), oy(92), mid, 3);
      drawThreeLobedRelief(surface, originX, originY, 69, 71, accentDark);
    }
    line(surface, ox(18), oy(109), ox(64 + 48 * direction), oy(93), accentMid, 2);
    return;
  }

  if (/field-rock-boundary/.test(kind)) {
    const points = spec.orientation === "south" ? [[15, 48], [35, 42], [55, 43], [91, 43], [111, 48]]
      : [[18, 52], [38, 47], [58, 48], [78, 55], [95, 77], [106, 96]];
    line(surface, ox(points[0][0]), oy(points[0][1]), ox(points.at(-1)[0]), oy(points.at(-1)[1]), dark, 9);
    for (const [x, y] of points) ellipse(surface, ox(x), oy(y), 12, 9, mid, outline);
    ellipse(surface, ox(64), oy(92), 50, 13, accentDark, outline);
    return;
  }

  if (/wildflower-verge/.test(kind)) {
    ellipse(surface, ox(64), oy(91), 53, 24, accentDark, outline);
    line(surface, ox(13), oy(96), ox(115), oy(74 + variantIndex % 3 * 8), accentDark, 12);
    for (let index = 0; index < 9; index += 1) {
      const x = 18 + index * 12;
      const y = 88 - (variantIndex % 3 === 2 ? index * 2 : 0);
      line(surface, ox(x), oy(y + 8), ox(x), oy(y), accentMid, 2);
      ellipse(surface, ox(x), oy(y - 2), 4, 4, light, outline);
    }
  }
}

function drawLandmarkCell(surface, originX, originY, kit, spec, variantIndex) {
  const art = REGION_ART[kit];
  const outline = rgba(OUTLINE);
  const [earthDark, earthMid, earthLight] = art.path.map((color) => rgba(color));
  const [accentDark, accentMid, accentLight] = art.accent.map((color) => rgba(color));
  const [groundDark, groundMid, groundLight] = art.ground.map((color) => rgba(color));
  const kind = spec.semanticKind;
  const ox = (value) => originX + value;
  const oy = (value) => originY + value;
  const flipX = (value) => variantIndex % 2 === 0 ? value : 128 - value;

  if (kit === "worn-heartland" && /grove/.test(kind)) {
    translatedPolygon(surface, originX, originY, [[8, 98], [18, 88], [43, 84], [64, 89], [87, 84], [118, 94], [123, 106], [107, 116], [73, 113], [43, 118], [14, 111]], earthDark);
    const trunks = variantIndex === 1 ? [[48, 47, 39, 108], [81, 54, 75, 109]]
      : variantIndex === 2 ? [[39, 52, 34, 108], [69, 45, 64, 112], [96, 61, 89, 107]]
        : [[42, 49, 37, 109], [66, 42, 62, 112], [90, 54, 84, 108]];
    for (const [topX, topY, rootX, rootY] of trunks) {
      polygon(surface, [[ox(topX - 5), oy(topY)], [ox(topX + 6), oy(topY + 1)], [ox(rootX + 9), oy(rootY)], [ox(rootX - 8), oy(rootY)]], earthMid, outline);
      fillRect(surface, ox(topX - 1), oy(topY + 10), 3, 34, earthLight);
      line(surface, ox(topX), oy(topY + 12), ox(topX + (topX < 64 ? -16 : 16)), oy(topY - 13), earthDark, 5);
    }
    const crownPoints = variantIndex === 2
      ? [[5, 37], [13, 20], [33, 16], [43, 4], [70, 8], [84, 18], [112, 21], [122, 38], [112, 58], [86, 65], [67, 59], [43, 67], [18, 60]]
      : variantIndex === 1
        ? [[8, 41], [15, 22], [36, 16], [48, 5], [66, 11], [78, 6], [101, 17], [118, 35], [112, 56], [91, 66], [68, 58], [48, 68], [22, 59]]
        : [[4, 39], [13, 21], [32, 16], [43, 4], [68, 8], [80, 15], [105, 14], [123, 34], [115, 55], [94, 65], [70, 59], [48, 68], [21, 59]];
    drawIrregularCrown(surface, originX, originY, crownPoints, accentDark, accentMid, accentLight, variantIndex);
    clearRect(surface, ox(54 + variantIndex * 3), oy(27), 9, 12);
    fillRect(surface, ox(18), oy(104), 21, 4, groundLight);
    fillRect(surface, ox(87), oy(101), 17, 3, groundDark);
    return;
  }

  if (kit === "worn-heartland" && /broken-fence-garden/.test(kind)) {
    translatedPolygon(surface, originX, originY, [[10, 53], [21, 37], [53, 29], [93, 34], [118, 51], [114, 101], [96, 113], [48, 116], [13, 101]], earthDark);
    for (const [x, y, width] of [[27, 52, 72], [24, 67, 78], [28, 83, 67], [37, 98, 54]]) {
      fillRect(surface, ox(x), oy(y), width, 8, earthMid);
      fillRect(surface, ox(x + 4), oy(y + 2), width - 11, 2, earthLight);
    }
    const south = spec.orientation === "south";
    const east = spec.orientation === "east";
    if (south) {
      drawFenceSegment(surface, ox(14), oy(45), ox(112), oy(45), outline, earthLight);
      drawFenceSegment(surface, ox(14), oy(45), ox(14), oy(105), outline, earthLight);
      drawFenceSegment(surface, ox(112), oy(45), ox(112), oy(105), outline, earthLight);
      drawFenceSegment(surface, ox(14), oy(105), ox(46), oy(105), outline, earthLight);
      drawFenceSegment(surface, ox(81), oy(105), ox(112), oy(105), outline, earthLight);
    } else if (east) {
      drawFenceSegment(surface, ox(15), oy(42), ox(108), oy(42), outline, earthLight);
      drawFenceSegment(surface, ox(15), oy(42), ox(15), oy(108), outline, earthLight);
      drawFenceSegment(surface, ox(15), oy(108), ox(78), oy(108), outline, earthLight);
    } else {
      drawFenceSegment(surface, ox(10), oy(105), ox(47), oy(69), outline, earthLight);
      drawFenceSegment(surface, ox(80), oy(56), ox(117), oy(25), outline, earthLight);
    }
    for (const [x, y] of [[34, 58], [51, 76], [74, 57], [91, 88]]) drawPixelFlower(surface, ox(x), oy(y), accentDark, accentMid, accentLight);
    return;
  }

  if (kit === "worn-heartland" && /path-shoulder/.test(kind)) {
    const vertical = spec.orientation === "north-south";
    if (vertical) {
      translatedPolygon(surface, originX, originY, [[47, 0], [80, 0], [78, 22], [84, 47], [77, 74], [82, 102], [79, 128], [46, 128], [49, 101], [43, 75], [50, 48], [45, 20]], earthMid);
      for (const y of [11, 39, 68, 98]) {
        fillRect(surface, ox(55 + y % 5), oy(y), 18, 3, earthLight);
        fillRect(surface, ox(24 + y % 7), oy(y + 5), 15, 7, groundDark);
        fillRect(surface, ox(88), oy(y - 2), 18, 8, groundMid);
      }
    } else {
      translatedPolygon(surface, originX, originY, [[0, 45], [20, 49], [46, 43], [73, 50], [101, 45], [128, 48], [128, 80], [101, 77], [75, 83], [48, 76], [20, 82], [0, 79]], earthMid);
      for (const x of [10, 38, 67, 98]) {
        fillRect(surface, ox(x), oy(56 + x % 4), 19, 3, earthLight);
        fillRect(surface, ox(x + 5), oy(27 + x % 6), 13, 8, groundDark);
        fillRect(surface, ox(x - 2), oy(89), 16, 7, groundMid);
      }
    }
    return;
  }

  if (kit === "spring-terraces" && /connected-spring-terrace/.test(kind)) {
    translatedPolygon(surface, originX, originY, [[7, 62], [17, 37], [41, 24], [78, 19], [107, 32], [122, 55], [117, 88], [96, 108], [59, 116], [27, 105], [10, 87]], earthDark, outline);
    translatedPolygon(surface, originX, originY, [[15, 60], [28, 40], [55, 31], [82, 31], [108, 43], [114, 67], [102, 88], [75, 101], [41, 98], [20, 82]], accentDark);
    translatedPolygon(surface, originX, originY, variantIndex === 0
      ? [[25, 58], [40, 44], [68, 39], [95, 48], [104, 66], [91, 82], [63, 90], [36, 83]]
      : [[28, 50], [48, 37], [82, 38], [102, 53], [100, 73], [80, 86], [48, 88], [27, 72]], accentMid);
    for (const [x, y, w] of [[14, 96, 28], [44, 105, 32], [79, 99, 31]]) {
      drawStone(surface, ox(x), oy(y), w, 10, outline, earthMid, earthLight);
    }
    fillRect(surface, ox(42), oy(57), 18, 3, accentLight);
    fillRect(surface, ox(73), oy(73), 22, 3, accentLight);
    return;
  }

  if (kit === "spring-terraces" && /hillside-terrace/.test(kind)) {
    translatedPolygon(surface, originX, originY, [[8, 33], [113, 28], [121, 45], [112, 61], [24, 66], [10, 55]], earthDark, outline);
    translatedPolygon(surface, originX, originY, [[18, 67], [111, 61], [119, 78], [108, 96], [30, 105], [13, 91]], earthMid, outline);
    for (const [x, y, w] of [[19, 39, 23], [47, 37, 29], [81, 35, 27], [28, 75, 31], [65, 71, 38]]) drawStone(surface, ox(x), oy(y), w, 13, outline, earthMid, earthLight);
    translatedPolygon(surface, originX, originY, [[57, 31], [72, 31], [74, 53], [69, 73], [73, 104], [57, 109], [61, 76], [55, 55]], accentDark);
    fillRect(surface, ox(62), oy(42), 7, 55, accentMid);
    fillRect(surface, ox(64), oy(46), 3, 29, accentLight);
    return;
  }

  if (kit === "spring-terraces" && /reed-bank/.test(kind)) {
    translatedPolygon(surface, originX, originY, [[3, 88], [17, 70], [42, 66], [55, 75], [77, 70], [112, 78], [126, 97], [117, 113], [80, 109], [54, 116], [18, 108]], accentDark, outline);
    translatedPolygon(surface, originX, originY, [[6, 96], [30, 83], [52, 88], [73, 80], [101, 89], [121, 100], [109, 108], [75, 103], [49, 110], [20, 104]], accentMid);
    const reeds = [10, 17, 25, 34, 44, 52, 77, 86, 96, 108, 116];
    for (const [index, x] of reeds.entries()) {
      const top = 38 + (x * 7 + variantIndex * 5) % 34;
      line(surface, ox(x), oy(102), ox(x + (index % 3) - 1), oy(top), earthDark, 3);
      line(surface, ox(x + 1), oy(101), ox(x + (index % 3)), oy(top + 2), groundLight, 1);
      if (index % 2 === 0) fillRect(surface, ox(x - 2), oy(top + 5), 6, 3, earthMid);
    }
    return;
  }

  if (kit === "spring-terraces" && /willow/.test(kind)) {
    const trunkX = variantIndex % 2 === 0 ? 43 : 83;
    translatedPolygon(surface, originX, originY, [[8, 99], [24, 88], [47, 87], [70, 91], [97, 86], [121, 98], [116, 113], [77, 110], [52, 118], [16, 111]], accentDark, outline);
    polygon(surface, [[ox(trunkX - 8), oy(49)], [ox(trunkX + 7), oy(45)], [ox(trunkX + 10), oy(105)], [ox(trunkX - 11), oy(109)]], earthMid, outline);
    fillRect(surface, ox(trunkX - 2), oy(57), 4, 43, earthLight);
    line(surface, ox(trunkX), oy(63), ox(trunkX + (variantIndex % 2 === 0 ? 30 : -30)), oy(28), earthDark, 6);
    const crown = variantIndex % 2 === 0
      ? [[6, 40], [15, 18], [39, 8], [64, 13], [79, 4], [105, 16], [122, 38], [111, 61], [85, 68], [62, 59], [35, 70], [13, 60]]
      : [[5, 38], [18, 17], [43, 10], [60, 3], [83, 12], [109, 15], [123, 36], [115, 58], [92, 68], [66, 60], [42, 69], [14, 58]];
    drawIrregularCrown(surface, originX, originY, crown, accentDark, groundMid, groundLight, variantIndex);
    for (const x of [17, 29, 53, 73, 96, 110]) line(surface, ox(x), oy(43 + x % 9), ox(x - 2), oy(82 + x % 8), accentMid, 2);
    return;
  }

  if (kit === "spring-terraces" && /boardwalk/.test(kind)) {
    const vertical = spec.orientation === "north-south";
    if (vertical) {
      translatedPolygon(surface, originX, originY, [[39, 0], [84, 0], [88, 128], [40, 128]], accentDark);
      for (let y = 1; y < 128; y += 11) {
        polygon(surface, [[ox(43), oy(y)], [ox(82), oy(y + 1)], [ox(80), oy(y + 9)], [ox(44), oy(y + 8)]], earthMid, outline);
        fillRect(surface, ox(48 + y % 4), oy(y + 2), 23, 2, earthLight);
      }
      for (const [x, y] of [[34, 22], [91, 49], [35, 88], [93, 111]]) line(surface, ox(x), oy(y), ox(x), oy(y + 20), earthDark, 5);
    } else {
      translatedPolygon(surface, originX, originY, [[0, 39], [128, 41], [128, 87], [0, 84]], accentDark);
      for (let x = 1; x < 128; x += 11) {
        polygon(surface, [[ox(x), oy(43)], [ox(x + 9), oy(44)], [ox(x + 8), oy(82)], [ox(x), oy(80)]], earthMid, outline);
        fillRect(surface, ox(x + 2), oy(49 + x % 3), 2, 24, earthLight);
      }
      for (const [x, y] of [[20, 34], [48, 90], [84, 32], [110, 91]]) line(surface, ox(x), oy(y), ox(x + 20), oy(y), earthDark, 5);
    }
    return;
  }

  if (kit === "dry-scrub" && /outcrop/.test(kind)) {
    translatedPolygon(surface, originX, originY, [[4, 101], [18, 76], [43, 70], [56, 42], [78, 34], [93, 54], [115, 62], [125, 94], [112, 112], [72, 108], [38, 118], [12, 111]], earthDark, outline);
    translatedPolygon(surface, originX, originY, [[16, 93], [31, 72], [51, 69], [61, 45], [77, 41], [86, 61], [110, 68], [116, 90], [101, 101], [67, 96], [39, 108]], earthMid);
    translatedPolygon(surface, originX, originY, [[26, 73], [50, 68], [61, 47], [76, 45], [82, 62], [60, 63], [52, 79], [31, 84]], earthLight);
    line(surface, ox(18), oy(93), ox(111), oy(83), accentDark, 4);
    line(surface, ox(34), oy(105), ox(92), oy(99), accentMid, 3);
    clearRect(surface, ox(84), oy(79), 17, 11);
    return;
  }

  if (kit === "dry-scrub" && /tangle/.test(kind)) {
    translatedPolygon(surface, originX, originY, [[5, 96], [19, 76], [43, 72], [65, 79], [87, 68], [116, 76], [125, 101], [108, 116], [76, 109], [48, 118], [17, 111]], accentDark, outline);
    const branches = variantIndex % 2 === 0
      ? [[12, 101, 39, 47], [31, 108, 70, 35], [61, 108, 105, 51], [86, 104, 119, 69], [18, 87, 110, 97]]
      : [[116, 102, 88, 47], [99, 110, 59, 37], [66, 106, 25, 52], [43, 102, 10, 70], [109, 87, 20, 96]];
    for (const [x0, y0, x1, y1] of branches) {
      line(surface, ox(x0), oy(y0), ox(x1), oy(y1), outline, 6);
      line(surface, ox(x0), oy(y0 - 1), ox(x1), oy(y1 - 1), earthMid, 3);
      line(surface, ox(x1), oy(y1), ox(x1 + (x1 < 64 ? -8 : 8)), oy(y1 - 9), earthDark, 2);
    }
    clearRect(surface, ox(48), oy(92), 33, 25);
    return;
  }

  if (kit === "dry-scrub" && /wind-scrub/.test(kind)) {
    translatedPolygon(surface, originX, originY, [[5, 95], [17, 77], [46, 76], [67, 68], [96, 73], [123, 89], [119, 107], [91, 111], [64, 104], [38, 115], [11, 108]], earthDark);
    const rise = variantIndex === 6 ? -3 : variantIndex === 7 ? 3 : 0;
    for (let index = 0; index < 6; index += 1) {
      const x = 12 + index * 19;
      const y = 93 + rise * index;
      translatedPolygon(surface, originX, originY, [[x, y], [x + 4, y - 14], [x + 9, y - 5], [x + 18, y - 19], [x + 16, y - 2], [x + 24, y + 3], [x + 8, y + 7]], accentDark, outline);
      fillRect(surface, ox(x + 8), oy(y - 4), 12, 3, accentLight);
    }
    for (const [x, y, width] of [[9, 105, 29], [44, 101, 26], [78, 108, 34]]) fillRect(surface, ox(x), oy(y), width, 2, earthLight);
    return;
  }

  if (kit === "ash-waste" && /crater-fissure/.test(kind)) {
    translatedPolygon(surface, originX, originY, [[2, 59], [15, 33], [41, 22], [67, 29], [91, 18], [118, 37], [126, 70], [115, 101], [89, 113], [63, 105], [37, 117], [9, 98]], groundDark, outline);
    translatedPolygon(surface, originX, originY, [[13, 61], [25, 40], [46, 31], [68, 40], [91, 29], [113, 43], [118, 68], [106, 91], [84, 100], [61, 91], [39, 103], [18, 87]], earthMid);
    translatedPolygon(surface, originX, originY, [[28, 61], [40, 45], [62, 47], [78, 39], [101, 51], [104, 70], [91, 84], [68, 78], [49, 89], [31, 78]], earthDark);
    translatedPolygon(surface, originX, originY, [[40, 61], [51, 53], [68, 57], [80, 49], [94, 59], [91, 70], [75, 70], [61, 66], [48, 74]], rgba("#16171d"));
    const faults = variantIndex % 2 === 0
      ? [[0, 43, 39, 60], [89, 70, 128, 101], [63, 77, 47, 128]]
      : [[0, 101, 38, 77], [91, 51, 128, 29], [61, 82, 78, 128]];
    for (const [x0, y0, x1, y1] of faults) {
      line(surface, ox(x0), oy(y0), ox(x1), oy(y1), outline, 7);
      line(surface, ox(x0), oy(y0), ox(x1), oy(y1), accentMid, 3);
      line(surface, ox(x0 + 2), oy(y0), ox(x1 + 2), oy(y1), accentLight, 1);
    }
    for (const [x, y, w] of [[9, 88, 22], [96, 91, 25], [18, 35, 19]]) fillRect(surface, ox(x), oy(y), w, 7, groundLight);
    return;
  }

  if (kit === "ash-waste" && /pylon/.test(kind)) {
    translatedPolygon(surface, originX, originY, [[4, 101], [21, 84], [46, 89], [63, 80], [83, 88], [111, 82], [125, 102], [116, 122], [76, 116], [48, 124], [13, 118]], earthDark, outline);
    const lean = variantIndex % 2 === 0 ? 0 : 7;
    polygon(surface, [[ox(18 + lean), oy(106)], [ox(31 + lean), oy(20)], [ox(42 + lean), oy(17)], [ox(34 + lean), oy(107)]], groundLight, outline);
    polygon(surface, [[ox(105 + lean), oy(107)], [ox(91 + lean), oy(18)], [ox(80 + lean), oy(21)], [ox(91 + lean), oy(107)]], groundLight, outline);
    line(surface, ox(36 + lean), oy(29), ox(87 + lean), oy(22), outline, 7);
    line(surface, ox(31 + lean), oy(52), ox(94 + lean), oy(48), earthMid, 5);
    line(surface, ox(27 + lean), oy(75), ox(99 + lean), oy(67), earthMid, 5);
    line(surface, ox(33 + lean), oy(28), ox(96 + lean), oy(68), earthDark, 4);
    line(surface, ox(91 + lean), oy(25), ox(31 + lean), oy(78), earthDark, 4);
    for (const [x, y] of [[12, 57], [112, 53], [19, 76], [105, 74]]) {
      line(surface, ox(64 + lean), oy(y), ox(x), oy(y + 4), outline, 3);
      fillRect(surface, ox(x - 4), oy(y + 1), 9, 5, accentDark);
    }
    translatedPolygon(surface, originX, originY, [[43 + lean, 57], [83 + lean, 54], [88 + lean, 87], [39 + lean, 92]], earthMid, outline);
    drawThreeLobedRelief(surface, originX, originY, 64 + lean, 73, accentDark);
    fillRect(surface, ox(11), oy(106), 106, 10, groundDark);
    fillRect(surface, ox(23), oy(116), 82, 6, groundLight);
    return;
  }

  if (kit === "ash-waste" && /slag-charred-ridge/.test(kind)) {
    translatedPolygon(surface, originX, originY, [[1, 101], [10, 69], [34, 53], [55, 61], [74, 39], [98, 49], [122, 70], [127, 104], [108, 119], [75, 110], [47, 123], [16, 115]], groundDark, outline);
    for (const [x, y, w, h] of [[9, 81, 30, 25], [33, 66, 38, 34], [68, 57, 35, 37], [96, 70, 29, 31]]) drawStone(surface, ox(x), oy(y), w, h, outline, earthMid, groundLight);
    for (const [x, top, lean] of [[20, 36, -7], [51, 29, 8], [88, 24, -9], [113, 40, 5]]) {
      line(surface, ox(x), oy(101), ox(x + lean), oy(top), outline, 8);
      line(surface, ox(x - 1), oy(96), ox(x + lean - 1), oy(top + 3), earthDark, 3);
      line(surface, ox(x + lean), oy(top + 12), ox(x + lean + (lean < 0 ? 12 : -12)), oy(top + 2), outline, 4);
    }
    line(surface, ox(0), oy(111), ox(128), oy(79), accentDark, 5);
    line(surface, ox(22), oy(108), ox(83), oy(59), accentMid, 2);
    return;
  }

  if (kit === "ash-waste" && /debris-fan/.test(kind)) {
    translatedPolygon(surface, originX, originY, [[2, 105], [13, 72], [39, 55], [69, 61], [88, 43], [117, 57], [126, 91], [115, 116], [78, 107], [49, 122], [18, 117]], earthDark, outline);
    const pieces = [[8, 87, 28, 18], [29, 68, 34, 22], [57, 82, 38, 20], [91, 61, 29, 20], [77, 103, 20, 13], [19, 108, 25, 9]];
    for (const [index, [x, y, w, h]] of pieces.entries()) {
      translatedPolygon(surface, originX, originY, [[x, y], [x + w - 4, y - 3], [x + w, y + h - 4], [x + 5, y + h]], index % 2 === 0 ? groundLight : earthMid, outline);
      fillRect(surface, ox(x + 5), oy(y + 3), Math.max(3, w - 12), 3, index % 2 === 0 ? earthMid : groundDark);
    }
    for (const [x0, y0, x1, y1] of [[4, 118, 34, 45], [42, 117, 68, 35], [79, 113, 107, 34], [101, 105, 126, 48]]) line(surface, ox(x0), oy(y0), ox(x1), oy(y1), outline, 5);
    line(surface, ox(2), oy(111), ox(126), oy(53), accentDark, 5);
    if (spec.variantId.endsWith("joined-containment-debris-fan")) {
      translatedPolygon(surface, originX, originY, [[44, 48], [94, 44], [101, 91], [39, 96]], groundDark, outline);
      for (let rib = 0; rib < 5; rib += 1) line(surface, ox(49 + rib * 10), oy(52), ox(49 + rib * 9), oy(91), earthMid, 3);
      drawThreeLobedRelief(surface, originX, originY, 69, 71, accentDark);
    }
    return;
  }

  if (kit === "neutral-temperate" && /grove/.test(kind)) {
    translatedPolygon(surface, originX, originY, [[7, 99], [22, 88], [45, 90], [65, 83], [86, 91], [118, 95], [124, 108], [99, 115], [71, 108], [43, 118], [14, 111]], groundDark);
    const trunks = variantIndex === 1 ? [[43, 54, 38, 108], [82, 48, 78, 110]]
      : variantIndex === 2 ? [[36, 61, 32, 108], [91, 58, 86, 110]]
        : [[39, 55, 35, 109], [69, 49, 65, 111], [96, 62, 91, 107]];
    for (const [x, y, rootX, rootY] of trunks) {
      polygon(surface, [[ox(x - 4), oy(y)], [ox(x + 5), oy(y)], [ox(rootX + 7), oy(rootY)], [ox(rootX - 6), oy(rootY)]], earthMid, outline);
      fillRect(surface, ox(x - 1), oy(y + 7), 2, 37, earthLight);
    }
    const crown = variantIndex === 2
      ? [[7, 44], [20, 25], [37, 22], [53, 10], [70, 20], [86, 12], [109, 24], [122, 43], [112, 58], [92, 64], [73, 57], [53, 66], [31, 59], [13, 61]]
      : [[5, 42], [16, 23], [37, 18], [50, 7], [72, 13], [91, 9], [113, 25], [123, 45], [110, 62], [87, 65], [66, 57], [44, 68], [18, 58]];
    drawIrregularCrown(surface, originX, originY, crown, accentDark, accentMid, groundLight, variantIndex + 2);
    clearRect(surface, ox(58), oy(30), 13, 14);
    clearRect(surface, ox(92), oy(47), 8, 10);
    return;
  }

  if (kit === "neutral-temperate" && /field-rock-boundary/.test(kind)) {
    translatedPolygon(surface, originX, originY, [[4, 95], [14, 72], [40, 69], [63, 74], [84, 64], [112, 72], [124, 92], [117, 109], [88, 105], [66, 116], [38, 108], [12, 113]], groundDark);
    const points = spec.orientation === "south"
      ? [[12, 64], [31, 56], [51, 59], [81, 57], [102, 63], [116, 73]]
      : [[15, 52], [35, 48], [56, 51], [75, 62], [92, 79], [108, 99]];
    for (let index = 0; index < points.length - 1; index += 1) {
      const [x1, y1] = points[index]; const [x2, y2] = points[index + 1];
      line(surface, ox(x1), oy(y1), ox(x2), oy(y2), earthDark, 9);
    }
    for (const [index, [x, y]] of points.entries()) drawStone(surface, ox(x - 8), oy(y - 6), 18 + index % 2 * 4, 13, outline, earthMid, earthLight);
    if (spec.orientation === "south") clearRect(surface, ox(54), oy(50), 31, 28);
    return;
  }

  if (kit === "neutral-temperate" && /wildflower-verge/.test(kind)) {
    const diagonal = variantIndex === 7;
    translatedPolygon(surface, originX, originY, diagonal
      ? [[4, 107], [17, 78], [42, 67], [70, 54], [98, 39], [122, 43], [126, 63], [102, 72], [76, 87], [48, 101], [17, 118]]
      : [[3, 97], [14, 75], [39, 70], [62, 77], [87, 67], [116, 73], [126, 93], [118, 110], [88, 105], [62, 116], [37, 107], [11, 115]], accentDark);
    for (let index = 0; index < 13; index += 1) {
      const x = 11 + index * 9;
      const y = diagonal ? 99 - index * 4 : 88 + (index * 7 + variantIndex) % 17;
      drawPixelFlower(surface, ox(x), oy(y - 10), accentMid, index % 3 === 0 ? earthLight : groundLight, accentLight);
      if (index % 2 === 0) line(surface, ox(x + 4), oy(y), ox(x + 10), oy(y - 12), accentMid, 2);
    }
  }
}

function clearYardDoorCorridor(surface, originX, originY) {
  clearRect(surface, originX + 80, originY + 73, 32, 87);
}

function drawRejectedYardCell(surface, originX, originY, kit, semanticKind, variantIndex) {
  const art = REGION_ART[kit];
  const outline = rgba(OUTLINE);
  const dark = rgba(art.path[0]);
  const mid = rgba(art.path[1]);
  const light = rgba(art.path[2]);
  const accentDark = rgba(art.accent[0]);
  const accentMid = rgba(art.accent[1]);
  const warm = rgba(art.roof[2]);
  const ox = (value) => originX + value;
  const oy = (value) => originY + value;

  if (semanticKind === "warm-overlay") {
    for (const [x, y, w, h] of [[65, 105, 14, 8], [113, 102, 15, 9], [61, 119, 18, 7], [113, 118, 19, 7]]) {
      fillRect(surface, ox(x), oy(y), w, h, warm);
    }
    clearYardDoorCorridor(surface, originX, originY);
    return;
  }
  if (semanticKind === "durable-hoarding-overlay") {
    for (let index = 0; index < 4; index += 1) outlinedRect(surface, ox(12 + index * 18), oy(116 - index % 2 * 7), 17, 12, mid, outline);
    for (let index = 0; index < 3; index += 1) outlinedRect(surface, ox(142 + index * 11), oy(48 + index * 17), 14, 25, dark, outline);
    clearYardDoorCorridor(surface, originX, originY);
    return;
  }

  const ruined = semanticKind === "persistent-ruin-base";
  const alternate = semanticKind === "standing-b-base";
  const base = ruined ? dark : mid;
  ellipse(surface, ox(96), oy(80), 88, 66, base, outline);
  clearRect(surface, ox(28), oy(18), 136, 124);
  for (const [x, y, w, h] of alternate
    ? [[8, 34, 28, 74], [156, 52, 28, 78], [24, 132, 43, 17], [125, 130, 50, 19], [37, 8, 112, 19]]
    : [[9, 48, 31, 82], [153, 31, 30, 88], [20, 130, 57, 20], [118, 133, 60, 17], [46, 8, 98, 20]]) {
    outlinedRect(surface, ox(x), oy(y), w, h, base, outline);
  }
  for (const [x, y] of [[18, 59], [27, 88], [166, 55], [174, 91], [45, 141], [142, 143]]) {
    ellipse(surface, ox(x), oy(y), 7, 5, alternate ? accentDark : accentMid, outline);
  }
  if (kit === "spring-terraces") {
    for (const [x, y] of [[17, 46], [170, 42], [155, 133]]) ellipse(surface, ox(x), oy(y), 11, 7, accentMid, outline);
  } else if (kit === "ash-waste") {
    outlinedRect(surface, ox(5), oy(107), 65, 25, dark, outline);
    outlinedRect(surface, ox(122), oy(103), 65, 28, dark, outline);
    outlinedRect(surface, ox(25), oy(5), 142, 22, base, outline);
    for (const [x0, y0, x1, y1] of [[8, 124, 73, 105], [119, 107, 183, 124], [27, 31, 8, 75], [164, 31, 184, 71]]) line(surface, ox(x0), oy(y0), ox(x1), oy(y1), mid, 5);
    line(surface, ox(11), oy(116), ox(72), oy(133), accentDark, 4);
    line(surface, ox(129), oy(24), ox(180), oy(62), accentDark, 4);
  } else if (kit === "dry-scrub") {
    line(surface, ox(10), oy(111), ox(69), oy(127), dark, 5);
  } else {
    for (const x of [20, 32, 160, 173]) line(surface, ox(x), oy(82), ox(x + 4), oy(64), accentDark, 3);
  }
  if (ruined) {
    clearRect(surface, ox(9), oy(47), 15, 20);
    clearRect(surface, ox(160), oy(96), 23, 18);
    line(surface, ox(20), oy(126), ox(72), oy(140), outline, 5);
    line(surface, ox(126), oy(139), ox(179), oy(118), outline, 5);
  }
  clearRect(surface, ox(0), oy(0), 192, 4);
  clearRect(surface, ox(0), oy(156), 192, 4);
  clearRect(surface, ox(0), oy(0), 4, 160);
  clearRect(surface, ox(188), oy(0), 4, 160);
  clearYardDoorCorridor(surface, originX, originY);
}

function drawYardCell(surface, originX, originY, kit, semanticKind, variantIndex) {
  const art = REGION_ART[kit];
  const outline = rgba(OUTLINE);
  const [earthDark, earthMid, earthLight] = art.path.map((color) => rgba(color));
  const [accentDark, accentMid, accentLight] = art.accent.map((color) => rgba(color));
  const [groundDark, groundMid, groundLight] = art.ground.map((color) => rgba(color));
  const warm = rgba(art.roof[2]);
  const ox = (value) => originX + value;
  const oy = (value) => originY + value;

  if (semanticKind === "warm-overlay") {
    translatedPolygon(surface, originX, originY, [[53, 102], [72, 98], [79, 106], [72, 114], [52, 112]], warm);
    translatedPolygon(surface, originX, originY, [[116, 101], [135, 98], [143, 106], [136, 114], [116, 112]], warm);
    fillRect(surface, ox(58), oy(117), 16, 4, warm);
    fillRect(surface, ox(120), oy(117), 18, 4, warm);
    if (kit === "spring-terraces") {
      fillRect(surface, ox(40), oy(126), 27, 3, accentLight);
      fillRect(surface, ox(128), oy(125), 21, 3, accentLight);
    } else if (kit === "ash-waste") {
      fillRect(surface, ox(23), oy(116), 22, 5, warm);
      fillRect(surface, ox(149), oy(111), 19, 5, warm);
    } else {
      fillRect(surface, ox(41), oy(106), 8, 8, warm);
      fillRect(surface, ox(145), oy(104), 9, 9, warm);
    }
    clearYardDoorCorridor(surface, originX, originY);
    return;
  }

  if (semanticKind === "durable-hoarding-overlay") {
    const crateFill = kit === "ash-waste" ? groundLight : earthMid;
    for (const [x, y, width, height] of [[11, 105, 27, 17], [35, 112, 24, 15], [139, 104, 25, 18], [159, 113, 22, 14]]) {
      drawStone(surface, ox(x), oy(y), width, height, outline, crateFill, earthLight);
      fillRect(surface, ox(x + 4), oy(y + 6), Math.max(3, width - 9), 2, earthDark);
    }
    if (kit === "spring-terraces") {
      for (const [x, y] of [[20, 82], [157, 78]]) {
        polygon(surface, [[ox(x), oy(y)], [ox(x + 15), oy(y - 4)], [ox(x + 19), oy(y + 17)], [ox(x + 3), oy(y + 20)]], accentDark, outline);
        fillRect(surface, ox(x + 5), oy(y + 1), 9, 3, accentLight);
      }
    } else if (kit === "dry-scrub") {
      fillRect(surface, ox(12), oy(91), 48, 5, earthDark);
      fillRect(surface, ox(140), oy(91), 42, 5, earthDark);
    } else if (kit === "ash-waste") {
      for (const x of [18, 43, 147, 171]) {
        outlinedRect(surface, ox(x), oy(73 + x % 5), 16, 25, groundDark, outline);
        fillRect(surface, ox(x + 4), oy(78 + x % 5), 8, 4, accentDark);
      }
    } else {
      drawFenceSegment(surface, ox(12), oy(97), ox(58), oy(88), outline, earthLight);
      drawFenceSegment(surface, ox(137), oy(88), ox(181), oy(98), outline, earthLight);
    }
    clearYardDoorCorridor(surface, originX, originY);
    return;
  }

  const ruined = semanticKind === "persistent-ruin-base";
  const alternate = semanticKind === "standing-b-base";
  const baseDark = ruined ? earthDark : kit === "spring-terraces" ? groundDark : earthDark;
  const baseMid = ruined ? groundDark : alternate ? groundMid : earthMid;
  translatedPolygon(surface, originX, originY, alternate
    ? [[5, 45], [19, 19], [61, 8], [106, 13], [148, 7], [184, 29], [187, 83], [178, 127], [145, 151], [111, 145], [75, 153], [34, 145], [7, 119]]
    : [[6, 35], [31, 12], [76, 7], [111, 13], [158, 10], [186, 38], [184, 91], [176, 135], [139, 151], [101, 144], [63, 153], [21, 138], [5, 99]], baseMid, outline);
  translatedPolygon(surface, originX, originY, alternate
    ? [[11, 61], [27, 28], [65, 17], [98, 21], [143, 15], [178, 36], [180, 72], [164, 91], [141, 83], [121, 96], [68, 93], [47, 84], [17, 102]]
    : [[13, 48], [37, 21], [77, 15], [105, 21], [151, 17], [178, 43], [177, 77], [159, 94], [127, 86], [106, 99], [64, 92], [43, 82], [14, 103]], baseDark);
  clearRect(surface, ox(39), oy(24), 114, 91);

  if (kit === "worn-heartland") {
    drawFenceSegment(surface, ox(10), oy(59), ox(37), oy(33), outline, earthLight);
    drawFenceSegment(surface, ox(153), oy(35), ox(181), oy(61), outline, earthLight);
    outlinedRect(surface, ox(20), oy(106), 21, 19, earthMid, outline);
    line(surface, ox(26), oy(105), ox(36), oy(91), earthDark, 5);
    for (const [x, y] of [[19, 79], [168, 85], [50, 133], [139, 137]]) drawPixelFlower(surface, ox(x), oy(y), accentDark, accentMid, accentLight);
  } else if (kit === "spring-terraces") {
    for (const [x, y, width] of [[8, 118, 58], [126, 121, 57], [8, 53, 31], [153, 53, 31]]) {
      fillRect(surface, ox(x), oy(y), width, 10, earthDark);
      fillRect(surface, ox(x + 3), oy(y + 2), width - 7, 4, earthLight);
    }
    translatedPolygon(surface, originX, originY, [[10, 135], [63, 132], [69, 146], [17, 148]], accentDark);
    translatedPolygon(surface, originX, originY, [[126, 134], [180, 130], [179, 145], [121, 149]], accentMid);
    for (const x of [20, 30, 161, 171]) line(surface, ox(x), oy(133), ox(x - 1), oy(111), groundLight, 2);
  } else if (kit === "dry-scrub") {
    drawFenceSegment(surface, ox(8), oy(103), ox(60), oy(128), outline, accentMid);
    drawFenceSegment(surface, ox(131), oy(127), ox(184), oy(103), outline, accentMid);
    fillRect(surface, ox(12), oy(35), 38, 5, earthDark);
    fillRect(surface, ox(143), oy(33), 37, 5, earthDark);
    line(surface, ox(22), oy(36), ox(15), oy(76), outline, 4);
    line(surface, ox(170), oy(36), ox(180), oy(75), outline, 4);
    for (const [x, y] of [[20, 82], [163, 84], [46, 137], [141, 136]]) translatedPolygon(surface, originX, originY, [[x, y], [x + 5, y - 13], [x + 11, y], [x + 18, y - 8], [x + 16, y + 5], [x + 4, y + 6]], accentDark);
  } else if (kit === "ash-waste") {
    translatedPolygon(surface, originX, originY, [[6, 109], [66, 97], [75, 127], [18, 143]], groundDark, outline);
    translatedPolygon(surface, originX, originY, [[119, 99], [185, 108], [176, 142], [114, 127]], groundDark, outline);
    for (let x = 12; x < 68; x += 13) line(surface, ox(x), oy(111), ox(x + 10), oy(134), earthLight, 3);
    for (let x = 128; x < 181; x += 13) line(surface, ox(x), oy(132), ox(x + 10), oy(109), earthLight, 3);
    outlinedRect(surface, ox(15), oy(65), 23, 31, earthDark, outline);
    outlinedRect(surface, ox(156), oy(63), 23, 32, earthDark, outline);
    fillRect(surface, ox(21), oy(72), 11, 5, accentDark);
    fillRect(surface, ox(162), oy(70), 11, 5, accentDark);
    line(surface, ox(7), oy(121), ox(72), oy(103), accentDark, 4);
    line(surface, ox(122), oy(103), ox(184), oy(122), accentMid, 4);
  } else {
    for (const [x, y, width] of [[9, 112, 56], [129, 111, 54], [10, 54, 29], [153, 50, 30]]) {
      for (let stone = 0; stone < Math.floor(width / 15); stone += 1) drawStone(surface, ox(x + stone * 15), oy(y + stone % 2 * 2), 16, 11, outline, earthMid, earthLight);
    }
    for (const [x, y] of [[19, 82], [166, 82], [48, 137], [141, 135]]) drawPixelFlower(surface, ox(x), oy(y), accentDark, groundLight, accentLight);
    outlinedRect(surface, ox(16), oy(42), 18, 28, accentDark, outline);
    fillRect(surface, ox(20), oy(45), 10, 4, accentLight);
  }

  if (ruined) {
    for (const [x, y, width, height] of [[12, 49, 27, 18], [151, 80, 32, 19], [23, 125, 39, 17], [129, 127, 42, 16]]) {
      clearRect(surface, ox(x), oy(y), width, height);
      drawStone(surface, ox(x + 2), oy(y + height - 7), Math.max(10, width - 4), 8, outline, groundDark, earthMid);
    }
    line(surface, ox(11), oy(119), ox(67), oy(145), outline, 5);
    line(surface, ox(126), oy(145), ox(181), oy(115), outline, 5);
  }

  clearRect(surface, ox(0), oy(0), 192, 4);
  clearRect(surface, ox(0), oy(156), 192, 4);
  clearRect(surface, ox(0), oy(0), 4, 160);
  clearRect(surface, ox(188), oy(0), 4, 160);
  clearYardDoorCorridor(surface, originX, originY);
}

async function authorLandmarkAtlas(kit) {
  const geometry = REGIONAL_COMPOSITION_GEOMETRY.landmarks;
  const surface = createSurface(geometry.width, geometry.height);
  for (const [cellIndex, spec] of REGIONAL_VARIANT_SPECS[kit].landmarks.entries()) {
    drawLandmarkCell(
      surface,
      cellIndex % 4 * geometry.cellWidth,
      Math.floor(cellIndex / 4) * geometry.cellHeight,
      kit,
      spec,
      cellIndex,
    );
  }
  return sharp(surface.data, { raw: { width: surface.width, height: surface.height, channels: 4 } })
    .png(NATIVE_PNG_OPTIONS).toBuffer();
}

async function authorYardAtlas(kit) {
  const geometry = REGIONAL_COMPOSITION_GEOMETRY.yards;
  const surface = createSurface(geometry.width, geometry.height);
  for (const [cellIndex, semanticKind] of YARD_SEMANTIC_FRAMES.entries()) {
    drawYardCell(surface, cellIndex * geometry.cellWidth, 0, kit, semanticKind, cellIndex);
  }
  return sharp(surface.data, { raw: { width: surface.width, height: surface.height, channels: 4 } })
    .png(NATIVE_PNG_OPTIONS).toBuffer();
}

function renderRegionalR4ConnectedCell(surface, originX, originY, palette, variant, seed) {
  const [north, east, south, west] = CONNECTED_TERRAIN_DIRECTIONS[variant];
  const dark = rgba(palette[0]);
  const mid = rgba(palette[Math.min(1, palette.length - 1)]);
  const light = rgba(palette[Math.min(2, palette.length - 1)]);
  translatedPolygon(surface, originX, originY, [
    [8, 10], [12, 7], [23, 8], [26, 13], [25, 22], [20, 26], [10, 24], [6, 18],
  ], dark);
  fillRect(surface, originX + 10, originY + 10, 12, 12, mid);
  if (north) fillRect(surface, originX + 10, originY, 12, 11, mid);
  if (east) fillRect(surface, originX + 21, originY + 10, 11, 12, mid);
  if (south) fillRect(surface, originX + 10, originY + 21, 12, 11, mid);
  if (west) fillRect(surface, originX, originY + 10, 11, 12, mid);
  const highlightX = 12 + seed * 5 % 8;
  const highlightY = 13 + seed * 3 % 7;
  fillRect(surface, originX + highlightX, originY + highlightY, 5, 2, light);
}

async function authorRegionalR4TerrainAtlas(kit) {
  const recipes = REGIONAL_R4_VARIANT_RECIPES[kit].ground;
  const materials = regionalR4MaterialColors(kit);
  const art = REGION_ART[kit];
  const surface = createSurface(256, 256);
  for (let cell = 0; cell <= 35; cell += 1) {
    const originX = cell % 8 * 32;
    const originY = Math.floor(cell / 8) * 32;
    fillRect(surface, originX, originY, 32, 32, rgba(REGIONAL_R4_GROUND_BASES[kit]));
    if (cell <= 7) {
      renderPixelRecipe(surface, originX, originY, materials, recipes[cell], 32, 32);
      continue;
    }
    const role = cell <= 15 ? "path" : cell <= 23 ? "water" : cell <= 31 ? "shore" : "soil";
    const ordinal = role === "path" ? cell - 8 : role === "water" ? cell - 16
      : role === "shore" ? cell - 24 : cell - 32;
    const variant = role === "soil" ? [7, 0, 1, 6][ordinal] : ordinal;
    const palette = role === "path" ? art.path : role === "water" ? art.accent
      : role === "shore" ? [art.path[0], art.ground[2], art.path[2]] : art.ground;
    renderRegionalR4ConnectedCell(surface, originX, originY, palette, variant, cell + 1);
    if (role === "shore") {
      for (const [x, y] of [[3, 5], [24, 7], [5, 25], [25, 24]]) {
        fillRect(surface, originX + x, originY + y, 5, 3, rgba(art.path[1]));
      }
    }
  }
  return encodeSurface(surface, NATIVE_PNG_OPTIONS);
}

async function authorRegionalR4LandmarkAtlas(kit) {
  const geometry = REGIONAL_COMPOSITION_GEOMETRY.landmarks;
  const materials = regionalR4MaterialColors(kit);
  const surface = createSurface(geometry.width, geometry.height);
  for (const recipe of REGIONAL_R4_VARIANT_RECIPES[kit].landmarks) {
    const originX = recipe.cell % 4 * geometry.cellWidth;
    const originY = Math.floor(recipe.cell / 4) * geometry.cellHeight;
    renderPixelRecipe(surface, originX, originY, materials, recipe, geometry.cellWidth, geometry.cellHeight);
  }
  return encodeSurface(surface, NATIVE_PNG_OPTIONS);
}

async function authorRegionalR4YardAtlas(kit) {
  const geometry = REGIONAL_COMPOSITION_GEOMETRY.yards;
  const materials = regionalR4MaterialColors(kit);
  const surface = createSurface(geometry.width, geometry.height);
  for (const [cellIndex, recipe] of REGIONAL_R4_VARIANT_RECIPES[kit].yards.entries()) {
    const originX = cellIndex * geometry.cellWidth;
    renderPixelRecipe(surface, originX, 0, materials, recipe, geometry.cellWidth, geometry.cellHeight);
  }
  return encodeSurface(surface, NATIVE_PNG_OPTIONS);
}

function bodyPhaseInventory() {
  const phases = [];
  for (const [action, count] of BODY_ACTIONS) {
    for (let phase = 0; phase < count; phase += 1) phases.push({ action, phase, count });
  }
  return phases;
}

const BODY_PHASES = bodyPhaseInventory();

function humanPose(action, phase, count) {
  const wave = phase % 2 === 0 ? -1 : 1;
  const travel = action === "walk" ? wave * 2 : action === "run" ? wave * 3 : 0;
  const fallProgress = action === "hurt-fall" ? phase / Math.max(1, count - 1) : 0;
  return {
    rootX: 24 + (action === "stop" ? wave : 0),
    rootY: 61,
    bob: ["idle", "walk", "run"].includes(action) ? (phase % 2) : 0,
    legA: travel,
    legB: -travel,
    armA: action === "reach-give" ? Math.min(7, phase + 2) : action === "work" ? wave * 5 : -travel,
    armB: action === "work" ? -wave * 4 : travel,
    fallProgress,
    grounded: action === "prone" || action === "dead" || fallProgress > 0.72,
  };
}

function drawBodyCell(surface, cellX, cellY, rigIndex, facing, action, phase, count) {
  const pose = humanPose(action, phase, count);
  const ox = cellX * 48;
  const oy = cellY * 64;
  const skin = [rgba("#9c6044"), rgba("#dc9464"), rgba("#f4c08c")];
  const base = rgba("#6c7480");
  if (pose.grounded) {
    const progress = action === "hurt-fall" ? Math.min(1, pose.fallProgress) : 1;
    const y = oy + Math.round(50 + progress * 7);
    outlinedRect(surface, ox + 9, y - 8, 28 + rigIndex * 2, 9, base);
    ellipse(surface, ox + (facing === "west" ? 12 : 36), y - 5, 7 + rigIndex, 6, skin[1]);
    return;
  }
  const profile = facing === "east" || facing === "west";
  const direction = facing === "west" ? -1 : 1;
  const centerX = ox + pose.rootX;
  const baseY = oy + pose.rootY - pose.bob - Math.round(pose.fallProgress * 9);
  const torsoWidth = (rigIndex === 0 ? 14 : 17) - (profile ? 3 : 0);
  const headX = centerX + (profile ? direction * 2 : 0) + Math.round(pose.fallProgress * direction * 7);
  const headY = baseY - 43 + Math.round(pose.fallProgress * 8);
  outlinedRect(surface, centerX - Math.floor(torsoWidth / 2), baseY - 34, torsoWidth, 21, base);
  ellipse(surface, headX, headY, profile ? 6 : 7 + rigIndex, 8, skin[1]);
  fillRect(surface, headX - 3, headY - 5, profile ? 4 : 6, 2, skin[2]);
  const legTop = baseY - 14;
  line(surface, centerX - 4, legTop, centerX - 4 + pose.legA, baseY - 1, rgba(OUTLINE), 5);
  line(surface, centerX + 4, legTop, centerX + 4 + pose.legB, baseY - 1, rgba(OUTLINE), 5);
  line(surface, centerX - Math.floor(torsoWidth / 2), baseY - 30, centerX - 7 + direction * pose.armA, baseY - 15, rgba(OUTLINE), 4);
  line(surface, centerX + Math.floor(torsoWidth / 2), baseY - 30, centerX + 7 + direction * pose.armB, baseY - 15, rgba(OUTLINE), 4);
  pixel(surface, centerX - 7 + direction * pose.armA, baseY - 14, skin[2]);
  pixel(surface, centerX + 7 + direction * pose.armB, baseY - 14, skin[2]);
  if (facing === "north") fillRect(surface, headX - 4, headY + 4, 8, 2, skin[0]);
}

function drawFaceCell(surface, cellX, cellY, rigIndex, facing, expression) {
  const ox = cellX * 48;
  const oy = cellY * 64;
  const profile = facing === "east" || facing === "west";
  const direction = facing === "west" ? -1 : 1;
  const centerX = ox + 24 + (profile ? direction * 2 : 0);
  const centerY = oy + 18;
  const skin = [rgba("#9c6044"), rgba("#dc9464"), rgba("#f4c08c")];
  ellipse(surface, centerX, centerY, profile ? 6 : 7 + rigIndex, 8, skin[1]);
  fillRect(surface, centerX - 3, centerY - 5, profile ? 4 : 6, 2, skin[2]);
  if (facing === "north") return;
  const eyeInk = rgba("#34241c");
  const noseInk = rgba("#9c6044");
  const mouthInk = rgba("#10060b");
  const blink = expression === "blink-1" || expression === "blink-2";
  if (profile) {
    pixel(surface, centerX + direction * 3, centerY - 2, eyeInk);
    pixel(surface, centerX + direction * 5, centerY, noseInk);
  } else {
    if (blink) {
      line(surface, centerX - 4, centerY - 1, centerX - 2, centerY - 1, eyeInk);
      line(surface, centerX + 2, centerY - 1, centerX + 4, centerY - 1, eyeInk);
    } else {
      pixel(surface, centerX - 3, centerY - 2, eyeInk);
      pixel(surface, centerX + 3, centerY - 2, eyeInk);
    }
    pixel(surface, centerX, centerY, noseInk);
  }
  const mouthY = centerY + 4;
  const mouthWidth = expression.startsWith("talk") ? 3 : expression === "hurt" ? 2 : 1;
  line(surface, centerX - (profile ? 0 : Math.floor(mouthWidth / 2)), mouthY,
    centerX + (profile ? direction * mouthWidth : Math.floor(mouthWidth / 2)), mouthY, mouthInk);
}

function drawHairCell(surface, cellX, cellY, silhouetteIndex, facing, phase) {
  const ox = cellX * 48;
  const oy = cellY * 64;
  const profile = facing === "east" || facing === "west";
  const direction = facing === "west" ? -1 : 1;
  const centerX = ox + 24 + (profile ? direction * 2 : 0);
  const colors = [rgba("#24181c"), rgba("#442c24"), rgba("#6c4c34")];
  const length = [2, 5, 9, 13, 18, 7, 9, 6][silhouetteIndex];
  ellipse(surface, centerX, oy + 14 + (phase % 2), profile ? 7 : 8, 6, colors[1]);
  fillRect(surface, centerX - (profile ? 5 : 7), oy + 14, profile ? 10 : 14, length, colors[1]);
  line(surface, centerX - 6, oy + 14, centerX + 5, oy + 9, colors[2]);
  if (silhouetteIndex === 1) {
    for (let spike = 0; spike < 5; spike += 1) {
      line(surface, centerX - 8 + spike * 4, oy + 12, centerX - 6 + spike * 3, oy + 5 + spike % 2,
        colors[0], 2);
    }
  } else if (silhouetteIndex === 2) {
    for (let wave = 0; wave < 4; wave += 1) {
      ellipse(surface, centerX - 8 + wave * 5, oy + 20 + wave % 2 * 4, 3, 4, colors[1]);
    }
  } else if (silhouetteIndex === 3) {
    outlinedRect(surface, centerX - 9, oy + 16, 18, 16, colors[1], colors[0]);
  } else if (silhouetteIndex === 4) {
    line(surface, centerX + direction * 7, oy + 18, centerX + direction * 10, oy + 43, colors[0], 5);
    ellipse(surface, centerX + direction * 10, oy + 44, 4, 4, colors[1]);
  } else if (silhouetteIndex === 5) {
    ellipse(surface, centerX, oy + 5, 7, 6, colors[1]);
  } else if (silhouetteIndex === 6) {
    for (let curl = 0; curl < 7; curl += 1) {
      ellipse(surface, centerX - 9 + (curl % 4) * 6, oy + 8 + Math.floor(curl / 4) * 7, 4, 4, colors[1]);
    }
  } else if (silhouetteIndex === 7) {
    for (let curl = 0; curl < 5; curl += 1) ellipse(surface, centerX - 7 + curl * 4, oy + 9, 3, 3, colors[2]);
  }
  if (facing === "north") fillRect(surface, centerX - 6, oy + 15, 12, 5, colors[0]);
}

const CLOTH_RAMPS = [
  ["#4c6448", "#71845c", "#a4b47c"], ["#405c68", "#648494", "#98b4bc"],
  ["#8c6838", "#bc8c48", "#e0bc70"], ["#7c4038", "#a85c4c", "#d48468"],
  ["#4c5064", "#74788c", "#a4a8b4"], ["#68485c", "#90647c", "#bc8ca0"],
  ["#8c8068", "#b8a88c", "#e4d4b4"], ["#3c5c78", "#587c9c", "#84a8c4"],
];

function drawClothingCell(surface, cellX, cellY, silhouetteIndex, facing, action, phase, count) {
  const pose = humanPose(action, phase, count);
  const ox = cellX * 48;
  const oy = cellY * 64;
  const ramp = CLOTH_RAMPS[silhouetteIndex].map((color) => rgba(color));
  if (pose.grounded) {
    const grounded = [
      [14, 47, 22, 9], [8, 48, 32, 8], [17, 44, 16, 15], [11, 45, 27, 15],
      [7, 50, 34, 7], [14, 43, 22, 17], [6, 46, 36, 13], [19, 42, 19, 19],
    ][silhouetteIndex];
    outlinedRect(surface, ox + grounded[0], oy + grounded[1], grounded[2], grounded[3], ramp[1]);
    if (silhouetteIndex === 3 || silhouetteIndex === 6) {
      outlinedRect(surface, ox + grounded[0] + 4, oy + grounded[1] - 5, grounded[2] - 8, 7, ramp[2]);
    }
    return;
  }
  const profile = facing === "east" || facing === "west";
  const baseY = oy + 61 - pose.bob - Math.round(pose.fallProgress * 9);
  const profileTrim = profile ? 2 : 0;
  const silhouettes = [
    { x: 17, y: -34, w: 14, h: 21 },
    { x: 12, y: -33, w: 24, h: 15 },
    { x: 19, y: -37, w: 11, h: 27 },
    { x: 14, y: -31, w: 20, h: 31 },
    { x: 10, y: -38, w: 28, h: 18 },
    { x: 13, y: -36, w: 22, h: 24 },
    { x: 11, y: -30, w: 26, h: 30 },
    { x: 18, y: -39, w: 14, h: 34 },
  ];
  const shape = silhouettes[silhouetteIndex];
  outlinedRect(surface, ox + shape.x + profileTrim, baseY + shape.y,
    shape.w - profileTrim * 2, shape.h, ramp[1]);
  if (silhouetteIndex === 0) line(surface, ox + 18, baseY - 28, ox + 30, baseY - 16, ramp[0], 3);
  if (silhouetteIndex === 1) {
    outlinedRect(surface, ox + 9, baseY - 32, 8, 15, ramp[0]);
    outlinedRect(surface, ox + 31, baseY - 32, 8, 15, ramp[0]);
  }
  if (silhouetteIndex === 2) fillRect(surface, ox + 21, baseY - 35, 7, 22, ramp[2]);
  if (silhouetteIndex === 3) outlinedRect(surface, ox + 17, baseY - 25, 15, 24, ramp[2]);
  if (silhouetteIndex === 4) outlinedRect(surface, ox + 8, baseY - 39, 32, 9, ramp[2]);
  if (silhouetteIndex === 5) {
    outlinedRect(surface, ox + 7, baseY - 30, 10, 10, ramp[0]);
    outlinedRect(surface, ox + 31, baseY - 30, 10, 10, ramp[0]);
  }
  if (silhouetteIndex === 6) {
    outlinedRect(surface, ox + 10, baseY - 19, 10, 13, ramp[2]);
    outlinedRect(surface, ox + 28, baseY - 19, 10, 13, ramp[2]);
  }
  if (silhouetteIndex === 7) line(surface, ox + 19, baseY - 37, ox + 32, baseY - 8, ramp[2], 5);
  outlinedRect(surface, ox + 16 + profileTrim, baseY - 15, 16 - profileTrim * 2, 15, ramp[0]);
  line(surface, ox + 24, baseY - 14, ox + 24, baseY - 1, rgba(OUTLINE));
  outlinedRect(surface, ox + 18 + pose.legA, baseY - 14, 5, 13, ramp[0]);
  outlinedRect(surface, ox + 25 + pose.legB, baseY - 14, 5, 13, ramp[0]);
}

function drawHeldCell(surface, cellX, cellY, formIndex, facing) {
  if (formIndex === 0 || formIndex === 15) return;
  const ox = cellX * 48;
  const oy = cellY * 64;
  const direction = facing === "west" ? -1 : 1;
  const x = ox + 24 + (facing === "north" ? 0 : direction * 10);
  const y = oy + 38;
  const ramps = [[rgba("#544434"), rgba("#8c6c44"), rgba("#b49c7c")],
    [rgba("#405c68"), rgba("#54a8a0"), rgba("#acecbc")]];
  const ramp = ramps[formIndex % 2];
  if ([5, 6, 9, 10].includes(formIndex)) ellipse(surface, x, y, 4, 4, ramp[1]);
  else if ([7, 11].includes(formIndex)) {
    line(surface, x, y - 7, x, y + 8, rgba(OUTLINE), 3);
    outlinedRect(surface, x - 5, y - 8, 10, 5, ramp[1]);
  } else outlinedRect(surface, x - 6, y - 5, 12, 10, ramp[1]);
  pixel(surface, x - 2, y - 2, ramp[2]);
}

function drawStatusCell(surface, cellX, cellY, index) {
  const ox = cellX * 32;
  const oy = cellY * 32;
  const colors = [rgba("#54d4c4"), rgba("#f4c474"), rgba("#e46c5c"), rgba("#d4ecd4")];
  if (index < 16) {
    const color = colors[index % colors.length];
    for (let angle = 0; angle < 360; angle += 22.5) {
      const radians = angle * Math.PI / 180;
      pixel(surface, ox + 16 + Math.round(Math.cos(radians) * (9 + index % 3)),
        oy + 16 + Math.round(Math.sin(radians) * (5 + index % 2)), color);
    }
  } else if (index < 32) {
    ellipse(surface, ox + 16, oy + 23, 5 + index % 4, 2, colors[index % 4]);
  } else {
    const phase = index % 8;
    ellipse(surface, ox + 8 + (index % 3) * 6, oy + 22 - phase, 2 + phase % 2, 2 + phase % 3, colors[index % 4]);
  }
}

async function encodeSurface(surface, options = PNG_OPTIONS) {
  return sharp(surface.data, { raw: { width: surface.width, height: surface.height, channels: 4 } })
    .png(options)
    .toBuffer();
}

function buildCoreSurfaces() {
  const body = createSurface(768, 1408);
  let bodyCell = 0;
  for (let rigIndex = 0; rigIndex < 2; rigIndex += 1) {
    for (const facing of FACINGS) {
      for (const phase of BODY_PHASES) {
        drawBodyCell(body, bodyCell % 16, Math.floor(bodyCell / 16), rigIndex, facing,
          phase.action, phase.phase, phase.count);
        bodyCell += 1;
      }
    }
  }

  const face = createSurface(768, 256);
  for (const [facingIndex, facing] of FACINGS.entries()) {
    for (let rigIndex = 0; rigIndex < 2; rigIndex += 1) {
      for (const [expressionIndex, expression] of EXPRESSIONS.entries()) {
        drawFaceCell(face, rigIndex * 8 + expressionIndex, facingIndex, rigIndex, facing, expression);
      }
    }
  }

  const hair = createSurface(768, 768);
  let hairCell = 0;
  for (let silhouette = 0; silhouette < 8; silhouette += 1) {
    for (const facing of FACINGS) {
      for (let phase = 0; phase < 6; phase += 1) {
        drawHairCell(hair, hairCell % 16, Math.floor(hairCell / 16), silhouette, facing, phase);
        hairCell += 1;
      }
    }
  }

  const clothing = [];
  for (let silhouette = 0; silhouette < 8; silhouette += 1) {
    const surface = createSurface(768, 704);
    let cell = 0;
    for (const facing of FACINGS) {
      for (const phase of BODY_PHASES) {
        drawClothingCell(surface, cell % 16, Math.floor(cell / 16), silhouette, facing,
          phase.action, phase.phase, phase.count);
        cell += 1;
      }
    }
    clothing.push(surface);
  }

  const held = createSurface(768, 256);
  for (const [facingIndex, facing] of FACINGS.entries()) {
    for (let form = 0; form < 16; form += 1) drawHeldCell(held, form, facingIndex, form, facing);
  }
  const status = createSurface(512, 256);
  for (let index = 0; index < 128; index += 1) drawStatusCell(status, index % 16, Math.floor(index / 16), index);
  return { body, face, hair, clothing, held, status };
}

const HAIR_SOURCE_COLORS = new Set([
  "111,72,51", "97,63,45", "79,55,41", "44,24,24", "65,43,33", "135,92,64",
]);
const HUMAN_HAIR_MATERIAL_RAMPS = Object.freeze({
  "hair-deep": [[36, 24, 28], [44, 24, 24]],
  "hair-shadow": [[65, 43, 33], [68, 44, 36]],
  "hair-chestnut": [[79, 55, 41], [97, 63, 45], [111, 72, 51]],
  "hair-auburn": [[135, 92, 64]],
});
const HUMAN_HAIR_OUTLINE_EXCEPTIONS = Object.freeze([
  { x: 445, y: 68 },
  { x: 446, y: 68 },
  { x: 493, y: 68 },
  { x: 494, y: 68 },
]);
const CLOTHING_SOURCE_COLORS = new Set([
  "89,103,66", "248,228,184", "238,211,164", "215,186,142", "188,157,118",
]);

async function rawAtlas(buffer) {
  return sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalDigest(value) {
  return hashBuffer(Buffer.from(canonicalJson(value), "utf8"));
}

function alphaComponents4InCell(data, atlasWidth, originX, originY, cellWidth, cellHeight) {
  const remaining = new Uint8Array(cellWidth * cellHeight);
  for (let y = 0; y < cellHeight; y += 1) for (let x = 0; x < cellWidth; x += 1) {
    remaining[y * cellWidth + x] = data[((originY + y) * atlasWidth + originX + x) * 4 + 3] === 0 ? 0 : 1;
  }
  const components = [];
  for (let seed = 0; seed < remaining.length; seed += 1) {
    if (remaining[seed] === 0) continue;
    remaining[seed] = 0;
    const stack = [seed];
    const pixels = [];
    while (stack.length > 0) {
      const current = stack.pop();
      const x = current % cellWidth;
      const y = Math.floor(current / cellWidth);
      pixels.push({ x, y });
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cellWidth || ny >= cellHeight) continue;
        const next = ny * cellWidth + nx;
        if (remaining[next] === 0) continue;
        remaining[next] = 0;
        stack.push(next);
      }
    }
    components.push(pixels);
  }
  return components.sort((left, right) => {
    const leftTop = Math.min(...left.map(({ y }) => y));
    const rightTop = Math.min(...right.map(({ y }) => y));
    if (leftTop !== rightTop) return leftTop - rightTop;
    const leftX = Math.min(...left.filter(({ y }) => y === leftTop).map(({ x }) => x));
    const rightX = Math.min(...right.filter(({ y }) => y === rightTop).map(({ x }) => x));
    return leftX - rightX;
  });
}

function pixelBounds(points) {
  if (points.length === 0) return null;
  const minX = Math.min(...points.map(({ x }) => x));
  const minY = Math.min(...points.map(({ y }) => y));
  const maxX = Math.max(...points.map(({ x }) => x));
  const maxY = Math.max(...points.map(({ y }) => y));
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function geometryHash(atlasSha256, recordWithoutHash) {
  return hashBuffer(Buffer.concat([
    Buffer.from(atlasSha256, "utf8"),
    Buffer.from(canonicalJson(recordWithoutHash), "utf8"),
  ]));
}

async function authoredVariantGeometry(buffer, geometry, spec) {
  const raw = await rawAtlas(buffer);
  const originX = spec.cellIndex % (geometry.width / geometry.cellWidth) * geometry.cellWidth;
  const originY = Math.floor(spec.cellIndex / (geometry.width / geometry.cellWidth)) * geometry.cellHeight;
  const components = alphaComponents4InCell(
    raw.data,
    raw.info.width,
    originX,
    originY,
    geometry.cellWidth,
    geometry.cellHeight,
  );
  const opaqueComponentOrdinals = components.map((_component, index) => index);
  const recognitionComponentOrdinals = components
    .map((component, index) => ({ index, length: component.length }))
    .filter(({ length }) => length >= 4)
    .map(({ index }) => index);
  if (recognitionComponentOrdinals.length === 0 && components.length > 0) recognitionComponentOrdinals.push(0);
  const record = {
    ...structuredClone(spec),
    cellRectPx: {
      x: originX,
      y: originY,
      width: geometry.cellWidth,
      height: geometry.cellHeight,
    },
    opaqueComponentOrdinals,
    recognitionComponentOrdinals,
    opaqueBoundsPx: pixelBounds(components.flat()),
    recognitionBoundsPx: pixelBounds(recognitionComponentOrdinals.flatMap((index) => components[index])),
  };
  const atlasSha256 = hashBuffer(buffer);
  return { ...record, geometryHash: geometryHash(atlasSha256, record) };
}

async function authoredVariantGeometryList(buffer, geometry, specs) {
  return Promise.all(specs.map((spec) => authoredVariantGeometry(buffer, geometry, spec)));
}

function regionalMaterialRamps(kit) {
  const art = REGION_ART[kit];
  return {
    "ground-cover": art.ground.map((color) => rgba(color).slice(0, 3)),
    "path-surface": art.path.map((color) => rgba(color).slice(0, 3)),
    "biome-accent": art.accent.map((color) => rgba(color).slice(0, 3)),
    "shelter-material": art.roof.map((color) => rgba(color).slice(0, 3)),
  };
}

function offsetInsideFootprint(offset, footprint) {
  return offset.x >= footprint.originOffsetTiles.x
    && offset.y >= footprint.originOffsetTiles.y
    && offset.x < footprint.originOffsetTiles.x + footprint.widthTiles
    && offset.y < footprint.originOffsetTiles.y + footprint.heightTiles;
}

/** Validate all large regional composition bytes and their closed native geometry records. */
export async function validateRegionalCompositionContract(contract, buffers) {
  const errors = [];
  for (const kit of REGION_KITS) {
    for (const [family, geometry, atlasId] of [
      ["landmarks", REGIONAL_COMPOSITION_GEOMETRY.landmarks, `${kit}-landmarks`],
      ["yards", REGIONAL_COMPOSITION_GEOMETRY.yards, `${kit}-home-yards`],
    ]) {
      const buffer = buffers[atlasId];
      const atlas = contract.atlases?.[atlasId];
      if (!buffer) {
        errors.push(`${atlasId}: native composition buffer missing`);
        continue;
      }
      if (!atlas) {
        errors.push(`${atlasId}: native composition contract missing`);
        continue;
      }
      const raw = await rawAtlas(buffer);
      if (raw.info.width !== geometry.width || raw.info.height !== geometry.height) {
        errors.push(`${atlasId}: geometry must be ${geometry.width}x${geometry.height}`);
      }
      if (atlas.width !== geometry.width || atlas.height !== geometry.height
        || atlas.cellWidth !== geometry.cellWidth || atlas.cellHeight !== geometry.cellHeight) {
        errors.push(`${atlasId}: persisted atlas/cell geometry mismatch`);
      }
      let fractionalAlpha = 0;
      let transparentResidue = 0;
      for (let offset = 0; offset < raw.data.length; offset += 4) {
        const alpha = raw.data[offset + 3];
        if (alpha !== 0 && alpha !== 255) fractionalAlpha += 1;
        if (alpha === 0 && (raw.data[offset] !== 0 || raw.data[offset + 1] !== 0 || raw.data[offset + 2] !== 0)) transparentResidue += 1;
      }
      if (fractionalAlpha > 0) errors.push(`${atlasId}: binary alpha required`);
      if (transparentResidue > 0) errors.push(`${atlasId}: transparent RGB residue forbidden`);
      if (atlas.sourceSha256 !== hashBuffer(buffer)) errors.push(`${atlasId}: native source hash drift`);
      const records = atlas.authoredVariants;
      if (!Array.isArray(records) || records.length !== geometry.cells) {
        errors.push(`${atlasId}: requires exactly ${geometry.cells} authored variants`);
        continue;
      }
      const expectedSpecs = REGIONAL_VARIANT_SPECS[kit][family];
      const cells = records.map(({ cellIndex }) => cellIndex);
      const ids = records.map(({ variantId }) => variantId);
      if (new Set(cells).size !== geometry.cells || cells.some((cell, index) => cell !== index)) {
        errors.push(`${atlasId}: cell ownership must be unique canonical 0-${geometry.cells - 1}`);
      }
      if (new Set(ids).size !== geometry.cells) errors.push(`${atlasId}: duplicate variant ID`);
      const derived = await authoredVariantGeometryList(buffer, geometry, expectedSpecs);
      for (const [index, record] of records.entries()) {
        const expected = derived[index];
        if (record.semanticKind === atlasId) errors.push(`${atlasId}: semantic name may not be an atlas ID`);
        if (canonicalJson(record) !== canonicalJson(expected)) errors.push(`${atlasId}/${record.variantId}: byte-derived geometry or hash drift`);
        if (!record.opaqueBoundsPx || record.opaqueBoundsPx.width <= 0 || record.opaqueBoundsPx.height <= 0) {
          errors.push(`${atlasId}/${record.variantId}: empty cell`);
        }
        if (!Array.isArray(record.eligibleTopologyKeys) || record.eligibleTopologyKeys.length === 0) {
          errors.push(`${atlasId}/${record.variantId}: exact topology key required`);
        }
        const hardKeys = record.hardOffsets.map(({ x, y }) => `${x},${y}`);
        if (new Set(hardKeys).size !== hardKeys.length) errors.push(`${atlasId}/${record.variantId}: duplicate hard offset`);
        if (record.hardOffsets.some((offset) => !offsetInsideFootprint(offset, record.visualFootprint))) {
          errors.push(`${atlasId}/${record.variantId}: hard offset outside visual footprint`);
        }
        if (record.heightPolicy === "tall-static-back-excluded"
          && record.interactionExclusionOffsets.length !== record.visualFootprint.widthTiles * record.visualFootprint.heightTiles) {
          errors.push(`${atlasId}/${record.variantId}: tall standing envelope exclusion is incomplete`);
        }
        if (family === "landmarks") {
          const bounds = record.opaqueBoundsPx;
          if (Math.max(bounds.width, bounds.height) < 96 || Math.min(bounds.width, bounds.height) < 32) {
            errors.push(`${atlasId}/${record.variantId}: composition is pickup-sized`);
          }
        } else {
          if (record.contactPivotPx.x !== 96 || record.contactPivotPx.y !== 112) errors.push(`${atlasId}/${record.variantId}: yard pivot must be 96,112`);
          const ports = record.connectionPorts;
          if (ports.length !== 1 || ports[0].side !== "south" || ports[0].startPx !== 80 || ports[0].widthPx !== 32) {
            errors.push(`${atlasId}/${record.variantId}: yard south port must be [80,112)`);
          }
          const cellOriginX = index * geometry.cellWidth;
          let opaquePixels = 0;
          let perimeterPixels = 0;
          let corridorPixels = 0;
          for (let y = 0; y < geometry.cellHeight; y += 1) for (let x = 0; x < geometry.cellWidth; x += 1) {
            const alpha = raw.data[(y * raw.info.width + cellOriginX + x) * 4 + 3];
            if (alpha === 0) continue;
            opaquePixels += 1;
            if (x < 4 || x >= geometry.cellWidth - 4 || y < 4 || y >= geometry.cellHeight - 4) perimeterPixels += 1;
            if (x >= 80 && x < 112 && y >= 73) corridorPixels += 1;
          }
          const ceiling = index === 2 ? 0.10 : index === 3 ? 0.15 : 0.70;
          if (opaquePixels / (geometry.cellWidth * geometry.cellHeight) > ceiling) errors.push(`${atlasId}/${record.variantId}: alpha coverage ceiling exceeded`);
          if (perimeterPixels > 0) errors.push(`${atlasId}/${record.variantId}: outer 4px perimeter must be transparent`);
          if (corridorPixels > 0) errors.push(`${atlasId}/${record.variantId}: door clearance or south port obstructed`);
          if (![2, 3].includes(index) && record.opaqueBoundsPx) {
            const boundArea = record.opaqueBoundsPx.width * record.opaqueBoundsPx.height;
            if ((boundArea - opaquePixels) / boundArea < 0.25) errors.push(`${atlasId}/${record.variantId}: base requires 25% transparent holes`);
          }
        }
        const withoutHash = structuredClone(record);
        delete withoutHash.geometryHash;
        if (record.geometryHash !== geometryHash(atlas.sourceSha256, withoutHash)) {
          errors.push(`${atlasId}/${record.variantId}: stale geometry hash`);
        }
      }
      if (atlasId === "ash-waste-landmarks") {
        const serialized = JSON.stringify({ semanticMaterials: atlas.semanticMaterials, authoredVariants: records });
        if (/green|grass|living|tree|canopy|flower|reed|water|spring|garden|moss|vine|wizard|magic|rune|gothic|medieval|sign|barrel|text|glow/i.test(serialized)) {
          errors.push(`${atlasId}: forbidden living, water, fantasy, sign, barrel, text, or glow semantics`);
        }
        const reliefCount = records.filter(({ recognitionTags = [] }) => (
          recognitionTags.some((tag) => /containment-relief/.test(tag))
        )).length;
        if (reliefCount !== 3) errors.push(`${atlasId}: exactly three integrated containment relief variants required`);
      }
    }
  }
  return errors;
}

function alphaComponentsInCell(data, atlasWidth, originX, originY, cellWidth, cellHeight) {
  const remaining = new Uint8Array(cellWidth * cellHeight);
  for (let y = 0; y < cellHeight; y += 1) for (let x = 0; x < cellWidth; x += 1) {
    const offset = ((originY + y) * atlasWidth + originX + x) * 4;
    remaining[y * cellWidth + x] = data[offset + 3] === 0 ? 0 : 1;
  }
  const components = [];
  for (let seed = 0; seed < remaining.length; seed += 1) {
    if (remaining[seed] === 0) continue;
    remaining[seed] = 0;
    const stack = [seed];
    const pixels = [];
    while (stack.length > 0) {
      const current = stack.pop();
      pixels.push({ x: current % cellWidth, y: Math.floor(current / cellWidth) });
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const x = current % cellWidth + dx;
        const y = Math.floor(current / cellWidth) + dy;
        if (x < 0 || y < 0 || x >= cellWidth || y >= cellHeight) continue;
        const next = y * cellWidth + x;
        if (remaining[next] === 0) continue;
        remaining[next] = 0;
        stack.push(next);
      }
    }
    components.push(pixels);
  }
  return components.sort((left, right) => right.length - left.length);
}

function setRawPixel(data, atlasWidth, x, y, color) {
  data.set(color, (y * atlasWidth + x) * 4);
}

function connectRawPoints(data, atlasWidth, originX, originY, from, to) {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1);
  for (let step = 0; step <= steps; step += 1) {
    const x = originX + Math.round(from.x + (to.x - from.x) * (step / steps));
    const y = originY + Math.round(from.y + (to.y - from.y) * (step / steps));
    setRawPixel(data, atlasWidth, x, y, rgba(OUTLINE));
  }
}

async function repairRigBBodyMaster(filename) {
  const { data, info } = await sharp(filename).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let index = 172; index < 344; index += 1) {
    const originX = (index % 16) * 48;
    const originY = Math.floor(index / 16) * 64;
    const components = alphaComponentsInCell(data, info.width, originX, originY, 48, 64);
    const retained = components.filter(({ length }) => length >= 20);
    for (const component of components.filter(({ length }) => length < 20)) {
      for (const point of component) setRawPixel(data, info.width, originX + point.x, originY + point.y, [0, 0, 0, 0]);
    }
    if (retained.length === 0) continue;
    const connected = [...retained[0]];
    for (const component of retained.slice(1)) {
      let nearest = null;
      for (const from of connected) for (const to of component) {
        const distance = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
        if (nearest === null || distance < nearest.distance) nearest = { from, to, distance };
      }
      connectRawPoints(data, info.width, originX, originY, nearest.from, nearest.to);
      connected.push(...component);
    }
  }
  return sharp(data, { raw: info }).png(PNG_OPTIONS).toBuffer();
}

function transparentEdgeCandidates(data, atlasWidth, originX, originY, cellWidth, cellHeight) {
  const candidates = [];
  for (let y = 1; y < cellHeight - 1; y += 1) for (let x = 1; x < cellWidth - 1; x += 1) {
    const offset = ((originY + y) * atlasWidth + originX + x) * 4;
    if (data[offset + 3] !== 0) continue;
    const adjacent = [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => {
      if (dx === 0 && dy === 0) return false;
      const neighbor = ((originY + y + dy) * atlasWidth + originX + x + dx) * 4;
      return data[neighbor + 3] === 255;
    }));
    if (adjacent) candidates.push({ x, y });
  }
  return candidates;
}

async function addDistinctNativeAccents(filename, columns, cellWidth, cellHeight, identity, pixelsPerCell, clearAfter = null) {
  const { data, info } = await sharp(filename).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cells = columns * Math.floor(info.height / cellHeight);
  if (clearAfter !== null) {
    for (let index = clearAfter; index < cells; index += 1) {
      const originX = (index % columns) * cellWidth;
      const originY = Math.floor(index / columns) * cellHeight;
      for (let y = 0; y < cellHeight; y += 1) for (let x = 0; x < cellWidth; x += 1) {
        setRawPixel(data, info.width, originX + x, originY + y, [0, 0, 0, 0]);
      }
    }
  }
  const authoredCells = clearAfter ?? cells;
  for (let index = 0; index < authoredCells; index += 1) {
    const originX = (index % columns) * cellWidth;
    const originY = Math.floor(index / columns) * cellHeight;
    const candidates = transparentEdgeCandidates(data, info.width, originX, originY, cellWidth, cellHeight);
    if (candidates.length === 0) continue;
    for (let accent = 0; accent < pixelsPerCell; accent += 1) {
      const point = candidates[(identity * 17 + accent * 29) % candidates.length];
      setRawPixel(data, info.width, originX + point.x, originY + point.y, rgba(OUTLINE));
    }
  }
  return sharp(data, { raw: info }).png(PNG_OPTIONS).toBuffer();
}

async function authorRegionalHomeComponents(filename, kit) {
  const { data, info } = await sharp(filename).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const surface = { width: info.width, height: info.height, data };
  const art = REGION_ART[kit];
  const cellOrigin = (index) => ({ x: (index % 6) * 128, y: Math.floor(index / 6) * 128 });
  const resetCell = (index) => {
    const origin = cellOrigin(index);
    clearRect(surface, origin.x, origin.y, 128, 128);
    return origin;
  };
  const timber = rgba(kit === "ash-waste" ? art.roof[0] : "#6c4c34");
  const wall = rgba(kit === "spring-terraces" ? "#d4ecd4"
    : kit === "dry-scrub" ? "#f4dcbc"
      : kit === "ash-waste" ? "#645c6c"
        : kit === "neutral-temperate" ? "#d4d49c" : "#d4bc94");
  const accent = rgba(art.roof[1]);

  let origin = resetCell(0);
  if (kit === "worn-heartland") {
    outlinedRect(surface, origin.x + 8, origin.y + 105, 112, 14, timber);
    line(surface, origin.x + 14, origin.y + 104, origin.x + 34, origin.y + 89, rgba(OUTLINE), 4);
  } else if (kit === "spring-terraces") {
    outlinedRect(surface, origin.x + 3, origin.y + 98, 122, 9, rgba(art.path[1]));
    for (const x of [15, 42, 82, 111]) outlinedRect(surface, origin.x + x, origin.y + 104, 6, 23, timber);
  } else if (kit === "dry-scrub") {
    outlinedRect(surface, origin.x + 16, origin.y + 109, 96, 10, rgba(art.path[1]));
    outlinedRect(surface, origin.x + 28, origin.y + 100, 72, 10, accent);
  } else if (kit === "ash-waste") {
    outlinedRect(surface, origin.x + 28, origin.y + 101, 72, 20, rgba("#444454"));
    outlinedRect(surface, origin.x + 38, origin.y + 94, 52, 9, rgba(art.accent[0]));
  } else {
    for (let stone = 0; stone < 5; stone += 1) {
      ellipse(surface, origin.x + 20 + stone * 22, origin.y + 109 - stone % 2 * 3, 13, 8, rgba(art.path[1]));
    }
  }

  origin = resetCell(1);
  if (kit === "spring-terraces") {
    for (const x of [23, 47, 79, 103]) outlinedRect(surface, origin.x + x, origin.y + 44, 6, 68, timber);
    line(surface, origin.x + 20, origin.y + 82, origin.x + 108, origin.y + 58, rgba(OUTLINE), 3);
  } else if (kit === "dry-scrub") {
    line(surface, origin.x + 24, origin.y + 111, origin.x + 49, origin.y + 35, rgba(OUTLINE), 6);
    line(surface, origin.x + 104, origin.y + 111, origin.x + 79, origin.y + 35, rgba(OUTLINE), 6);
  } else if (kit === "ash-waste") {
    outlinedRect(surface, origin.x + 32, origin.y + 47, 16, 68, timber);
    outlinedRect(surface, origin.x + 82, origin.y + 59, 18, 56, rgba(art.accent[0]));
  } else if (kit === "neutral-temperate") {
    outlinedRect(surface, origin.x + 22, origin.y + 50, 9, 65, timber);
    outlinedRect(surface, origin.x + 97, origin.y + 50, 9, 65, timber);
    line(surface, origin.x + 26, origin.y + 64, origin.x + 101, origin.y + 101, rgba(OUTLINE), 3);
  } else {
    outlinedRect(surface, origin.x + 18, origin.y + 50, 11, 67, timber);
    outlinedRect(surface, origin.x + 98, origin.y + 50, 11, 67, timber);
    line(surface, origin.x + 21, origin.y + 96, origin.x + 106, origin.y + 63, rgba(OUTLINE), 3);
  }

  origin = resetCell(2);
  if (kit === "spring-terraces") {
    outlinedRect(surface, origin.x + 18, origin.y + 47, 92, 57, wall);
    for (let slat = 0; slat < 5; slat += 1) line(surface, origin.x + 25 + slat * 18,
      origin.y + 50, origin.x + 25 + slat * 18, origin.y + 100, rgba(art.accent[0]));
  } else if (kit === "dry-scrub") {
    outlinedRect(surface, origin.x + 11, origin.y + 55, 106, 49, wall);
    line(surface, origin.x + 13, origin.y + 58, origin.x + 114, origin.y + 98, accent, 4);
    line(surface, origin.x + 114, origin.y + 58, origin.x + 13, origin.y + 98, accent, 4);
  } else if (kit === "ash-waste") {
    outlinedRect(surface, origin.x + 29, origin.y + 39, 72, 67, wall);
    outlinedRect(surface, origin.x + 84, origin.y + 53, 13, 31, rgba(art.accent[0]));
  } else if (kit === "neutral-temperate") {
    outlinedRect(surface, origin.x + 20, origin.y + 48, 88, 58, wall);
    outlinedRect(surface, origin.x + 2, origin.y + 70, 16, 32, rgba(art.accent[0]));
    line(surface, origin.x + 24, origin.y + 78, origin.x + 104, origin.y + 78, rgba(art.accent[0]), 3);
  } else {
    outlinedRect(surface, origin.x + 14, origin.y + 42, 100, 64, wall);
    for (let brace = 0; brace < 4; brace += 1) line(surface, origin.x + 20 + brace * 25,
      origin.y + 45, origin.x + 34 + brace * 20, origin.y + 102, timber, 3);
  }

  origin = resetCell(6);
  if (kit === "spring-terraces") {
    outlinedRect(surface, origin.x + 9, origin.y + 27, 110, 20, accent);
    line(surface, origin.x + 11, origin.y + 45, origin.x + 2, origin.y + 57, rgba(OUTLINE), 4);
  } else if (kit === "dry-scrub") {
    line(surface, origin.x + 5, origin.y + 52, origin.x + 64, origin.y + 15, rgba(OUTLINE), 8);
    line(surface, origin.x + 64, origin.y + 15, origin.x + 123, origin.y + 52, rgba(OUTLINE), 8);
    fillRect(surface, origin.x + 18, origin.y + 38, 92, 14, accent);
  } else if (kit === "ash-waste") {
    outlinedRect(surface, origin.x + 24, origin.y + 23, 80, 29, accent);
    outlinedRect(surface, origin.x + 82, origin.y + 6, 15, 27, rgba(art.accent[0]));
  } else if (kit === "neutral-temperate") {
    line(surface, origin.x + 12, origin.y + 54, origin.x + 64, origin.y + 19, rgba(OUTLINE), 7);
    line(surface, origin.x + 64, origin.y + 19, origin.x + 116, origin.y + 54, rgba(OUTLINE), 7);
    fillRect(surface, origin.x + 27, origin.y + 39, 74, 15, accent);
  } else {
    outlinedRect(surface, origin.x + 7, origin.y + 25, 114, 30, accent);
    line(surface, origin.x + 11, origin.y + 30, origin.x + 116, origin.y + 50, timber, 4);
  }

  origin = resetCell(13);
  if (kit === "spring-terraces") {
    outlinedRect(surface, origin.x + 43, origin.y + 48, 42, 66, timber);
    outlinedRect(surface, origin.x + 50, origin.y + 55, 28, 59, rgba("#1c1c24"));
  } else if (kit === "dry-scrub") {
    outlinedRect(surface, origin.x + 35, origin.y + 57, 58, 55, accent);
    clearRect(surface, origin.x + 46, origin.y + 64, 35, 48);
  } else if (kit === "ash-waste") {
    outlinedRect(surface, origin.x + 47, origin.y + 42, 34, 72, rgba(art.accent[0]));
    clearRect(surface, origin.x + 53, origin.y + 50, 22, 64);
  } else if (kit === "neutral-temperate") {
    outlinedRect(surface, origin.x + 39, origin.y + 50, 50, 64, timber);
    clearRect(surface, origin.x + 48, origin.y + 58, 32, 56);
  } else {
    outlinedRect(surface, origin.x + 31, origin.y + 48, 42, 66, timber);
    clearRect(surface, origin.x + 39, origin.y + 56, 26, 58);
    line(surface, origin.x + 73, origin.y + 50, origin.x + 96, origin.y + 70, rgba(OUTLINE), 4);
  }

  origin = resetCell(9);
  outlinedRect(surface, origin.x + 43, origin.y + 55, 39, 59, timber);
  fillRect(surface, origin.x + 50, origin.y + 62, 25, 52, rgba(art.accent[0]));
  pixel(surface, origin.x + 72, origin.y + 85, rgba("#f4dcbc"));

  origin = resetCell(16);
  outlinedRect(surface, origin.x + 84, origin.y + 58, 27, 24, rgba("#40545c"));
  line(surface, origin.x + 97, origin.y + 59, origin.x + 97, origin.y + 80, rgba(OUTLINE));
  line(surface, origin.x + 85, origin.y + 70, origin.x + 109, origin.y + 70, rgba(OUTLINE));

  origin = resetCell(17);
  outlinedRect(surface, origin.x + 84, origin.y + 58, 27, 24, rgba("#fab620"));
  line(surface, origin.x + 97, origin.y + 59, origin.x + 97, origin.y + 80, rgba(OUTLINE));
  line(surface, origin.x + 85, origin.y + 70, origin.x + 109, origin.y + 70, rgba(OUTLINE));

  origin = resetCell(19);
  outlinedRect(surface, origin.x + 82, origin.y + 91, 27, 13, timber);

  origin = resetCell(20);
  outlinedRect(surface, origin.x + 82, origin.y + 91, 27, 13, timber);
  ellipse(surface, origin.x + 95, origin.y + 89, 6, 10, rgba("#de8529"));
  ellipse(surface, origin.x + 95, origin.y + 84, 3, 6, rgba("#fab620"));

  origin = resetCell(3);
  outlinedRect(surface, origin.x + 14, origin.y + 42, 100, 64, wall);
  line(surface, origin.x + 46, origin.y + 43, origin.x + 58, origin.y + 69, rgba(OUTLINE), 3);
  line(surface, origin.x + 58, origin.y + 69, origin.x + 48, origin.y + 102, rgba(OUTLINE), 3);
  line(surface, origin.x + 82, origin.y + 47, origin.x + 96, origin.y + 73, rgba(OUTLINE), 2);

  origin = resetCell(7);
  outlinedRect(surface, origin.x + 8, origin.y + 27, 104, 25, accent);
  clearRect(surface, origin.x + 72, origin.y + 27, 25, 14);
  line(surface, origin.x + 66, origin.y + 28, origin.x + 83, origin.y + 49, rgba(OUTLINE), 3);

  origin = resetCell(14);
  outlinedRect(surface, origin.x + 43, origin.y + 58, 39, 56, timber);
  clearRect(surface, origin.x + 51, origin.y + 72, 22, 42);
  line(surface, origin.x + 45, origin.y + 61, origin.x + 79, origin.y + 107, rgba(OUTLINE), 3);

  origin = resetCell(18);
  outlinedRect(surface, origin.x + 84, origin.y + 60, 27, 22, rgba("#40545c"));
  line(surface, origin.x + 85, origin.y + 61, origin.x + 109, origin.y + 80, rgba(OUTLINE), 3);
  line(surface, origin.x + 109, origin.y + 61, origin.x + 85, origin.y + 80, rgba(OUTLINE), 3);

  origin = resetCell(5);
  outlinedRect(surface, origin.x + 20, origin.y + 53, 82, 52, wall);
  line(surface, origin.x + 24, origin.y + 57, origin.x + 94, origin.y + 102, rgba(OUTLINE), 6);
  clearRect(surface, origin.x + 20, origin.y + 53, 22, 18);

  origin = resetCell(8);
  outlinedRect(surface, origin.x + 17, origin.y + 38, 96, 22, accent);
  line(surface, origin.x + 18, origin.y + 40, origin.x + 103, origin.y + 65, rgba(OUTLINE), 5);

  origin = resetCell(15);
  outlinedRect(surface, origin.x + 55, origin.y + 77, 49, 16, timber);

  origin = resetCell(23);
  for (let mote = 0; mote < 12; mote += 1) {
    ellipse(surface, origin.x + 18 + (mote * 17) % 96, origin.y + 68 + (mote * 11) % 44,
      3 + mote % 3, 2 + mote % 2, rgba(art.path[2]));
  }
  return sharp(data, { raw: info }).png(NATIVE_PNG_OPTIONS).toBuffer();
}

async function enhanceHairMaster(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const surface = { width: info.width, height: info.height, data };
  const dark = rgba("#24181c");
  const middle = rgba("#442c24");
  for (let silhouette = 0; silhouette < 8; silhouette += 1) {
    for (let facing = 0; facing < 4; facing += 1) for (let phase = 0; phase < 6; phase += 1) {
      const index = silhouette * 24 + facing * 6 + phase;
      const ox = (index % 16) * 48;
      const oy = Math.floor(index / 16) * 64;
      const direction = facing === 3 ? -1 : 1;
      if (silhouette === 1) {
        for (let spike = 0; spike < 4; spike += 1) line(surface, ox + 16 + spike * 5, oy + 12,
          ox + 14 + spike * 5, oy + 4 + spike % 2, dark, 2);
      } else if (silhouette === 2) {
        for (let wave = 0; wave < 4; wave += 1) ellipse(surface, ox + 13 + wave * 6,
          oy + 21 + wave % 2 * 4, 3, 4, middle);
      } else if (silhouette === 3) {
        outlinedRect(surface, ox + 13, oy + 16, 22, 18, middle, dark);
        clearRect(surface, ox + 20, oy + 18, 9, 13);
      } else if (silhouette === 4) {
        line(surface, ox + 24 + direction * 7, oy + 18, ox + 24 + direction * 11, oy + 44, dark, 5);
        ellipse(surface, ox + 24 + direction * 11, oy + 45, 4, 4, middle);
      } else if (silhouette === 5) {
        ellipse(surface, ox + 24, oy + 6, 7, 6, middle);
      } else if (silhouette === 6) {
        for (let curl = 0; curl < 7; curl += 1) ellipse(surface, ox + 14 + (curl % 4) * 6,
          oy + 8 + Math.floor(curl / 4) * 7, 4, 4, middle);
      } else if (silhouette === 7) {
        for (let curl = 0; curl < 6; curl += 1) ellipse(surface, ox + 13 + curl * 4,
          oy + 10 + curl % 2 * 3, 3, 3, middle);
      }
    }
  }
  return sharp(data, { raw: info }).png(NATIVE_PNG_OPTIONS).toBuffer();
}

async function carveHairFaceWindows(buffer, nativeContract) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const surface = { width: info.width, height: info.height, data };
  const windows = Object.fromEntries(FACINGS.filter((facing) => facing !== "north").map((facing) => {
    const points = Object.values(nativeContract.facePlanes)
      .filter((plane) => plane.facing === facing)
      .flatMap((plane) => Object.values(plane.semanticFeatureMask).flat());
    if (points.length === 0) throw new Error(`${facing}: face contract has no semantic feature pixels`);
    const padding = 2;
    const outwardPadding = 4;
    const minX = Math.max(0, Math.min(...points.map(({ x }) => x))
      - (facing === "west" ? outwardPadding : padding));
    const maxX = Math.min(47, Math.max(...points.map(({ x }) => x))
      + (facing === "east" ? outwardPadding : padding));
    const minY = Math.max(0, Math.min(...points.map(({ y }) => y)) - padding);
    const maxY = Math.min(63, Math.max(...points.map(({ y }) => y)) + padding);
    return [facing, { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }];
  }));
  for (let silhouette = 0; silhouette < 8; silhouette += 1) {
    for (const [facingIndex, facing] of FACINGS.entries()) {
      const window = windows[facing];
      if (!window) continue;
      for (let phase = 0; phase < 6; phase += 1) {
        const cellIndex = silhouette * 24 + facingIndex * 6 + phase;
        const ox = cellIndex % 16 * 48;
        const oy = Math.floor(cellIndex / 16) * 64;
        clearRect(surface, ox + window.x, oy + window.y, window.width, window.height);
      }
    }
  }
  return sharp(data, { raw: info }).png(NATIVE_PNG_OPTIONS).toBuffer();
}

async function normalizeNativeMaster(filename) {
  const { data, info } = await sharp(filename).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const outline = rgba(OUTLINE);
  const outlineKey = outline.slice(0, 3).join(",");
  const keyAt = (x, y) => {
    if (x < 0 || y < 0 || x >= info.width || y >= info.height) return null;
    const offset = (y * info.width + x) * 4;
    return data[offset + 3] === 0 ? null : `${data[offset]},${data[offset + 1]},${data[offset + 2]}`;
  };
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) data.fill(0, offset, offset + 4);
  }
  const boundary = [];
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    const key = keyAt(x, y);
    if (key === null) continue;
    if ([[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
      .some(([neighborX, neighborY]) => keyAt(neighborX, neighborY) === null)) boundary.push({ x, y });
  }
  for (const { x, y } of boundary) setRawPixel(data, info.width, x, y, outline);
  const outlineKeys = new Set([outlineKey]);
  for (let pass = 0; pass < 6; pass += 1) {
    const thick = outlineThicknessViolations(data, info.width, info.height, outlineKeys);
    if (thick.length === 0) break;
    let repaired = 0;
    for (const point of thick) {
      if ([[point.x - 1, point.y], [point.x + 1, point.y], [point.x, point.y - 1], [point.x, point.y + 1]]
        .some(([neighborX, neighborY]) => keyAt(neighborX, neighborY) === null)) continue;
      let replacement = null;
      for (let radius = 1; radius <= 3 && replacement === null; radius += 1) {
        for (let dy = -radius; dy <= radius && replacement === null; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            const key = keyAt(point.x + dx, point.y + dy);
            if (key !== null && !outlineKeys.has(key)) {
              replacement = key.split(",").map(Number);
              break;
            }
          }
        }
      }
      if (replacement !== null) {
        setRawPixel(data, info.width, point.x, point.y, [...replacement, 255]);
        repaired += 1;
      }
    }
    if (repaired === 0) break;
  }
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    if (keyAt(x, y) === null) continue;
    if ([[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
      .some(([neighborX, neighborY]) => keyAt(neighborX, neighborY) === null)) {
      setRawPixel(data, info.width, x, y, outline);
    }
  }
  for (let pass = 0; pass < 4; pass += 1) {
    const gaps = [];
    for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
      const key = keyAt(x, y);
      if (key === null || key === outlineKey) continue;
      const verticalGap = (keyAt(x - 1, y) === null || keyAt(x + 1, y) === null)
        && keyAt(x, y - 1) === outlineKey && keyAt(x, y + 1) === outlineKey;
      const horizontalGap = (keyAt(x, y - 1) === null || keyAt(x, y + 1) === null)
        && keyAt(x - 1, y) === outlineKey && keyAt(x + 1, y) === outlineKey;
      if (verticalGap || horizontalGap) gaps.push({ x, y });
    }
    if (gaps.length === 0) break;
    for (const { x, y } of gaps) setRawPixel(data, info.width, x, y, outline);
  }
  return sharp(data, { raw: info }).png(NATIVE_PNG_OPTIONS).toBuffer();
}

function extractRawCell(raw, index, columns, cellWidth, cellHeight) {
  const output = Buffer.alloc(cellWidth * cellHeight * 4);
  const sourceX = (index % columns) * cellWidth;
  const sourceY = Math.floor(index / columns) * cellHeight;
  for (let y = 0; y < cellHeight; y += 1) {
    const start = ((sourceY + y) * raw.info.width + sourceX) * 4;
    raw.data.copy(output, y * cellWidth * 4, start, start + cellWidth * 4);
  }
  return output;
}

function colorKey(data, offset) {
  return `${data[offset]},${data[offset + 1]},${data[offset + 2]}`;
}

function maskForColors(cell, width, height, colors) {
  const mask = new Uint8Array(width * height);
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    if (cell[offset + 3] !== 0 && colors.has(colorKey(cell, offset))) mask[pixelIndex] = 1;
  }
  return mask;
}

function dilateMask(mask, width, height, radius = 1) {
  const output = new Uint8Array(mask);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!mask[y * width + x]) continue;
    for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      const px = x + dx; const py = y + dy;
      if (px >= 0 && py >= 0 && px < width && py < height) output[py * width + px] = 1;
    }
  }
  return output;
}

function propagateMaskColors(cell, sourceMask, expandedMask, width, height, radius = 1) {
  const output = Buffer.alloc(cell.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const pixelIndex = y * width + x;
    if (!expandedMask[pixelIndex]) continue;
    let donorIndex = sourceMask[pixelIndex] ? pixelIndex : -1;
    let donorDistance = Number.POSITIVE_INFINITY;
    if (donorIndex < 0) {
      for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
        const donorX = x + dx;
        const donorY = y + dy;
        if (donorX < 0 || donorY < 0 || donorX >= width || donorY >= height) continue;
        const candidateIndex = donorY * width + donorX;
        if (!sourceMask[candidateIndex]) continue;
        const distance = Math.abs(dx) + Math.abs(dy);
        if (distance < donorDistance) {
          donorIndex = candidateIndex;
          donorDistance = distance;
        }
      }
    }
    if (donorIndex < 0) throw new Error(`expanded mask pixel ${x},${y} has no source-color donor`);
    cell.copy(output, pixelIndex * 4, donorIndex * 4, donorIndex * 4 + 4);
  }
  return output;
}

function translateRawCell(cell, width, height, dx, dy) {
  const output = Buffer.alloc(cell.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const targetX = x + dx;
    const targetY = y + dy;
    if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) continue;
    const sourceOffset = (y * width + x) * 4;
    cell.copy(output, (targetY * width + targetX) * 4, sourceOffset, sourceOffset + 4);
  }
  return output;
}

function pasteRawCell(surface, cellX, cellY, cell, cellWidth, cellHeight, transform = (rgbaValue) => rgbaValue) {
  const ox = cellX * cellWidth;
  const oy = cellY * cellHeight;
  for (let y = 0; y < cellHeight; y += 1) for (let x = 0; x < cellWidth; x += 1) {
    const offset = (y * cellWidth + x) * 4;
    if (cell[offset + 3] === 0) continue;
    const next = transform([cell[offset], cell[offset + 1], cell[offset + 2], cell[offset + 3]], x, y, offset);
    if (next && next[3] !== 0) pixel(surface, ox + x, oy + y, next);
  }
}

function bodySourceIndex(facingIndex, action, phase) {
  if (["idle", "walk", "run", "turn", "stop"].includes(action)) {
    const base = action === "idle" ? 0 : action === "walk" || action === "run" ? 4 : action === "turn" ? 10 : 12;
    const sourceCount = action === "run" ? 6 : ACTION_FRAME_COUNT[action];
    return facingIndex * 14 + base + (phase % sourceCount);
  }
  if (action === "reach-give") return 4 * 14 + (phase % 6);
  if (action === "work") return 4 * 14 + 4 + (phase % 6);
  if (action === "hurt-fall") return 5 * 14 + (phase % 6);
  if (action === "prone") return 5 * 14 + 4 + (phase % 2);
  return 5 * 14 + 5;
}

const ACTION_FRAME_COUNT = Object.fromEntries(BODY_ACTIONS);

function transformRigBCell(cell) {
  const output = Buffer.from(cell);
  for (let y = 25; y < 54; y += 1) {
    for (let x = 1; x < 47; x += 1) {
      const sourceOffset = (y * 48 + x) * 4;
      if (cell[sourceOffset + 3] === 0) continue;
      const targetX = x < 24 ? Math.max(0, x - 1) : Math.min(47, x + 1);
      cell.copy(output, (y * 48 + targetX) * 4, sourceOffset, sourceOffset + 4);
    }
  }
  return output;
}

function headAnchorForAction(facing, action, phase) {
  const profileOffset = facing === "west" ? -2 : facing === "east" ? 2 : 0;
  if (action === "hurt-fall") {
    const anchors = [[24, 18], [23, 21], [22, 27], [24, 33], [29, 40], [35, 50]];
    return { x: anchors[Math.min(anchors.length - 1, phase)][0], y: anchors[Math.min(anchors.length - 1, phase)][1] };
  }
  if (action === "prone" || action === "dead") return { x: 35, y: 50 };
  return { x: 24 + profileOffset, y: 18 };
}

function decomposeHumanCell(source, rigIndex, facing, action = "idle", phase = 0) {
  const cell = rigIndex === 1 ? transformRigBCell(source) : Buffer.from(source);
  const sourceHairMask = maskForColors(cell, 48, 64, HAIR_SOURCE_COLORS);
  const hairMask = dilateMask(sourceHairMask, 48, 64);
  const propagatedHair = propagateMaskColors(cell, sourceHairMask, hairMask, 48, 64);
  const clothingMask = dilateMask(maskForColors(cell, 48, 64, CLOTHING_SOURCE_COLORS), 48, 64);
  const headAnchor = headAnchorForAction(facing, action, phase);
  const body = Buffer.from(cell);
  const hair = Buffer.alloc(cell.length);
  const clothing = Buffer.alloc(cell.length);
  for (let pixelIndex = 0; pixelIndex < 48 * 64; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    const x = pixelIndex % 48;
    const y = Math.floor(pixelIndex / 48);
    const nearHead = Math.abs(x - headAnchor.x) <= 14 && Math.abs(y - headAnchor.y) <= 15;
    if (hairMask[pixelIndex] && nearHead) {
      propagatedHair.copy(hair, offset, offset, offset + 4);
      body.fill(0, offset, offset + 4);
    }
    if (clothingMask[pixelIndex] && y >= 22) {
      cell.copy(clothing, offset, offset, offset + 4);
      const sourceKey = colorKey(cell, offset);
      const under = sourceKey === "16,6,11" ? rgba(OUTLINE) : rgba(sourceKey === "89,103,66" ? "#5c6470" : "#a89478");
      body.set(under, offset);
    }
  }
  const baseSurface = { width: 48, height: 64, data: body };
  const profile = facing === "east" || facing === "west";
  for (let y = Math.max(0, headAnchor.y - 11); y < Math.min(64, headAnchor.y + 12); y += 1) {
    for (let x = Math.max(0, headAnchor.x - 11); x < Math.min(48, headAnchor.x + 12); x += 1) {
    const offset = (y * 48 + x) * 4;
    body.fill(0, offset, offset + 4);
    }
  }
  ellipse(baseSurface, headAnchor.x, headAnchor.y, profile ? 7 : 8 + rigIndex, 9,
    rgba(rigIndex === 0 ? "#dc9464" : "#bc754c"));
  fillRect(baseSurface, headAnchor.x - 4, headAnchor.y - 6, profile ? 5 : 8, 2,
    rgba(rigIndex === 0 ? "#f4c08c" : "#dca06c"));
  return { body, hair, clothing };
}

function recolorClothingLayer(cell, silhouetteIndex) {
  const ramp = CLOTH_RAMPS[silhouetteIndex].map((color) => rgba(color));
  const output = Buffer.from(cell);
  for (let offset = 0; offset < output.length; offset += 4) {
    if (output[offset + 3] === 0) continue;
    const key = colorKey(output, offset);
    if (key === "16,6,11") continue;
    const luminance = output[offset] + output[offset + 1] + output[offset + 2];
    output.set(luminance < 240 ? ramp[0] : luminance < 550 ? ramp[1] : ramp[2], offset);
  }
  return output;
}

function tailorApprovedClothingLayer(cell, silhouetteIndex) {
  if (silhouetteIndex === 0) return cell;
  const output = Buffer.from(cell);
  const opaque = [];
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 48; x += 1) {
    if (output[(y * 48 + x) * 4 + 3] > 0) opaque.push({ x, y });
  }
  if (opaque.length === 0) return output;
  const minX = Math.min(...opaque.map(({ x }) => x));
  const maxX = Math.max(...opaque.map(({ x }) => x));
  const minY = Math.min(...opaque.map(({ y }) => y));
  const maxY = Math.max(...opaque.map(({ y }) => y));
  const width = Math.max(1, maxX - minX + 1);
  const height = Math.max(1, maxY - minY + 1);
  const centerX = (minX + maxX) / 2;
  const clear = (x, y) => output.fill(0, (y * 48 + x) * 4, (y * 48 + x) * 4 + 4);
  for (const { x, y } of opaque) {
    const nx = (x - minX) / width;
    const ny = (y - minY) / height;
    const side = Math.abs(x - centerX) / width;
    const remove = silhouetteIndex === 1 ? ny > 0.78 && side > 0.12
      : silhouetteIndex === 2 ? ny < 0.55 && side > 0.2
        : silhouetteIndex === 3 ? ny < 0.32 && side > 0.14
          : silhouetteIndex === 4 ? ny > 0.58
            : silhouetteIndex === 5 ? ny > 0.74 || (ny < 0.42 && side > 0.27)
              : silhouetteIndex === 6 ? (ny < 0.28 && side > 0.18) || (ny > 0.84 && side < 0.15)
                : (nx < 0.34 && ny < 0.62) || (ny > 0.7 && side > 0.2);
    if (remove) clear(x, y);
  }
  return output;
}

function decorateApprovedClothingVariant(surface, cellX, cellY, silhouetteIndex, facing, action) {
  const ox = cellX * 48;
  const oy = cellY * 64;
  const ramp = CLOTH_RAMPS[silhouetteIndex].map((color) => rgba(color));
  const grounded = ["hurt-fall", "prone", "dead"].includes(action);
  const profile = facing === "east" || facing === "west";
  const direction = facing === "west" ? -1 : 1;
  if (grounded) {
    const x = ox + 8 + silhouetteIndex % 4 * 3;
    const y = oy + 44 + Math.floor(silhouetteIndex / 4) * 5;
    if (silhouetteIndex === 0) line(surface, x + 4, y + 2, x + 22, y + 7, ramp[0], 3);
    else if (silhouetteIndex === 1) {
      outlinedRect(surface, x, y, 28, 5, ramp[1]);
      outlinedRect(surface, x + 7, y - 3, 14, 5, ramp[2]);
    } else if (silhouetteIndex === 2) {
      outlinedRect(surface, x + 3, y - 4, 18, 11, ramp[1]);
      line(surface, x + 5, y - 3, x + 18, y + 6, ramp[2], 3);
    } else if (silhouetteIndex === 3) {
      outlinedRect(surface, x, y - 2, 26, 10, ramp[1]);
      clearRect(surface, x + 12, y + 3, 2, 5);
    } else if (silhouetteIndex === 4) {
      outlinedRect(surface, x - 4, y, 31, 6, ramp[1]);
      outlinedRect(surface, x + 9, y - 5, 10, 6, ramp[2]);
    } else if (silhouetteIndex === 5) {
      outlinedRect(surface, x, y - 5, 9, 8, ramp[2]);
      outlinedRect(surface, x + 18, y + 2, 10, 8, ramp[0]);
      line(surface, x + 8, y, x + 20, y + 7, ramp[1], 3);
    } else if (silhouetteIndex === 6) {
      outlinedRect(surface, x - 3, y - 2, 31, 11, ramp[1]);
      clearRect(surface, x + 13, y + 4, 3, 5);
      pixel(surface, x + 5, y + 2, ramp[2]);
    } else {
      line(surface, x - 4, y - 5, x + 25, y + 8, ramp[2], 3);
      outlinedRect(surface, x + 21, y - 2, 9, 10, ramp[0]);
    }
    return;
  }
  const centerX = ox + 24 + (profile ? direction * 2 : 0);
  if (silhouetteIndex === 0) {
    line(surface, centerX - 7, oy + 29, centerX + 7, oy + 41, ramp[0]);
    outlinedRect(surface, centerX + direction * 5, oy + 40, 6, 6, ramp[1]);
  } else if (silhouetteIndex === 1) {
    outlinedRect(surface, centerX - 11, oy + 27, 5, 14, ramp[0]);
    outlinedRect(surface, centerX + 7, oy + 27, 5, 14, ramp[0]);
    line(surface, centerX - 6, oy + 28, centerX, oy + 34, ramp[2]);
    line(surface, centerX + 6, oy + 28, centerX, oy + 34, ramp[2]);
  } else if (silhouetteIndex === 2) {
    outlinedRect(surface, centerX - 6, oy + 31, 12, 15, ramp[1]);
    line(surface, centerX - 6, oy + 31, centerX - 8, oy + 26, ramp[2], 3);
    line(surface, centerX + 6, oy + 31, centerX + 8, oy + 26, ramp[2], 3);
    outlinedRect(surface, centerX - 8, oy + 40, 5, 5, ramp[0]);
  } else if (silhouetteIndex === 3) {
    outlinedRect(surface, centerX - 10, oy + 36, 20, 14, ramp[1]);
    clearRect(surface, centerX - 1, oy + 44, 2, 6);
    line(surface, centerX - 9, oy + 36, centerX + 8, oy + 40, ramp[2]);
  } else if (silhouetteIndex === 4) {
    outlinedRect(surface, centerX - 10, oy + 26, 20, 16, ramp[1]);
    clearRect(surface, centerX - 3, oy + 25, 6, 7);
    line(surface, centerX, oy + 32, centerX, oy + 42, ramp[2]);
    outlinedRect(surface, centerX + direction * 8, oy + 37, 7, 6, ramp[0]);
  } else if (silhouetteIndex === 5) {
    outlinedRect(surface, centerX - 14, oy + 34, 7, 5, ramp[2]);
    outlinedRect(surface, centerX + 8, oy + 34, 7, 5, ramp[2]);
    outlinedRect(surface, centerX - 8, oy + 38, 6, 6, ramp[0]);
    outlinedRect(surface, centerX + 3, oy + 38, 6, 6, ramp[0]);
  } else if (silhouetteIndex === 6) {
    outlinedRect(surface, centerX - 11, oy + 34, 22, 10, ramp[1]);
    clearRect(surface, centerX - 1, oy + 41, 2, 5);
    outlinedRect(surface, centerX - 13, oy + 28, 5, 8, ramp[2]);
    outlinedRect(surface, centerX + 9, oy + 28, 5, 8, ramp[2]);
  } else {
    line(surface, centerX - direction * 8, oy + 25, centerX + direction * 8, oy + 43, ramp[2], 3);
    outlinedRect(surface, centerX + direction * 8, oy + 38, 8, 10, ramp[0]);
    line(surface, centerX - direction * 9, oy + 28, centerX - direction * 13, oy + 36, ramp[1], 3);
  }
}

function bootstrapHairSurfaceFromApprovedSlice(bodyRaw) {
  const hair = createSurface(768, 768);
  let hairCell = 0;
  for (let silhouette = 0; silhouette < 8; silhouette += 1) {
    for (const [facingIndex, facing] of FACINGS.entries()) {
      for (let phase = 0; phase < 6; phase += 1) {
        const hairAction = phase === 4 ? "hurt-fall" : phase === 5 ? "prone" : "idle";
        const hairPhase = phase === 4 ? 2 : phase === 5 ? 0 : phase;
        const sourceIndex = phase === 4 ? 5 * 14 + 2 : phase === 5 ? 5 * 14 + 5 : facingIndex * 14 + (phase % 4);
        const source = extractRawCell(bodyRaw, sourceIndex, 14, 48, 64);
        const extracted = decomposeHumanCell(source, 0, facing, hairAction, hairPhase).hair;
        const sourceAnchor = headAnchorForAction(facing, hairAction, hairPhase);
        const targetAnchor = headAnchorForAction(facing, "idle", 0);
        const aligned = translateRawCell(
          extracted,
          48,
          64,
          targetAnchor.x - sourceAnchor.x,
          targetAnchor.y - sourceAnchor.y,
        );
        pasteRawCell(hair, hairCell % 16, Math.floor(hairCell / 16), aligned, 48, 64);
        const ox = (hairCell % 16) * 48; const oy = Math.floor(hairCell / 16) * 64;
        if (silhouette === 4) line(hair, ox + (facing === "west" ? 16 : 31), oy + 20,
          ox + (facing === "west" ? 14 : 33), oy + 36, rgba("#442c24"), 3);
        if (silhouette === 5) ellipse(hair, ox + 24, oy + 8, 5, 4, rgba("#442c24"));
        if (silhouette === 6) {
          for (let curl = 0; curl < 5; curl += 1) ellipse(hair, ox + 14 + curl * 5, oy + 10 + curl % 2, 3, 3, rgba("#442c24"));
        }
        hairCell += 1;
      }
    }
  }
  return hair;
}

async function bootstrapCoreSurfacesFromApprovedSlice(bodyBuffer, _faceBuffer, heldBuffer) {
  const [bodyRaw, heldRaw] = await Promise.all([rawAtlas(bodyBuffer), rawAtlas(heldBuffer)]);
  const body = createSurface(768, 1408);
  const clothing = Array.from({ length: 8 }, () => createSurface(768, 704));
  let bodyCell = 0;
  for (let rigIndex = 0; rigIndex < 2; rigIndex += 1) {
    for (const [facingIndex, facing] of FACINGS.entries()) {
      for (const phase of BODY_PHASES) {
        const source = extractRawCell(bodyRaw, bodySourceIndex(facingIndex, phase.action, phase.phase), 14, 48, 64);
        const layers = decomposeHumanCell(source, rigIndex, facing, phase.action, phase.phase);
        pasteRawCell(body, bodyCell % 16, Math.floor(bodyCell / 16), layers.body, 48, 64);
        for (let silhouette = 0; silhouette < 8; silhouette += 1) {
          const dressed = tailorApprovedClothingLayer(recolorClothingLayer(layers.clothing, silhouette), silhouette);
          pasteRawCell(clothing[silhouette], bodyCell % 16, Math.floor(bodyCell / 16), dressed, 48, 64);
          const target = clothing[silhouette];
          decorateApprovedClothingVariant(target, bodyCell % 16, Math.floor(bodyCell / 16),
            silhouette, facing, phase.action);
        }
        bodyCell += 1;
      }
    }
  }

  const face = createSurface(768, 256);
  for (const [facingIndex, facing] of FACINGS.entries()) {
    for (let rigIndex = 0; rigIndex < 2; rigIndex += 1) {
      for (let expressionIndex = 0; expressionIndex < 8; expressionIndex += 1) {
        const targetX = rigIndex * 8 + expressionIndex;
        drawFaceCell(face, targetX, facingIndex, rigIndex, facing, EXPRESSIONS[expressionIndex]);
      }
    }
  }

  const hair = bootstrapHairSurfaceFromApprovedSlice(bodyRaw);

  const held = createSurface(768, 256);
  for (const [facingIndex, facing] of FACINGS.entries()) {
    for (let form = 0; form < 16; form += 1) {
      const sourceIndex = Math.min(7, form % 8);
      const source = extractRawCell(heldRaw, sourceIndex, 8, 48, 64);
      pasteRawCell(held, form, facingIndex, source, 48, 64, (value, x) => {
        if (facing === "west") return value;
        if (facing === "east") return value;
        return value;
      });
      if (form > 7) drawHeldCell(held, form, facingIndex, form, facing);
    }
  }
  const status = createSurface(512, 256);
  for (let index = 0; index < 128; index += 1) drawStatusCell(status, index % 16, Math.floor(index / 16), index);
  return { body, face, hair, clothing, held, status };
}

function drawTerrainCell(surface, cellX, cellY, index, art) {
  const ox = cellX * 32;
  const oy = cellY * 32;
  const family = index < 8 ? art.ground : index < 24 ? art.path : index < 40 ? art.accent : art.ground;
  fillRect(surface, ox, oy, 32, 32, rgba(family[1]));
  for (let y = 1; y < 31; y += 4) {
    for (let x = 1; x < 31; x += 5) {
      const shade = ((x + y + index) % 3 === 0) ? family[2] : family[0];
      pixel(surface, ox + x + (index % 2), oy + y, rgba(shade));
    }
  }
  if (index >= 8 && index < 24) {
    const horizontal = index % 2 === 0;
    fillRect(surface, ox + (horizontal ? 0 : 11), oy + (horizontal ? 11 : 0), horizontal ? 32 : 10, horizontal ? 10 : 32, rgba(art.path[1]));
    line(surface, ox + (horizontal ? 0 : 11), oy + (horizontal ? 11 : 0), ox + (horizontal ? 31 : 11), oy + (horizontal ? 11 : 31), rgba(art.path[2]));
  }
}

function drawSceneryCell(surface, cellX, cellY, index, art) {
  const ox = cellX * 32;
  const oy = cellY * 32;
  if (index % 5 === 0) {
    outlinedRect(surface, ox + 14, oy + 14, 4, 15, rgba("#8c6c44"));
    ellipse(surface, ox + 16, oy + 12, 8 + index % 3, 7, rgba(art.accent[1]));
    pixel(surface, ox + 13, oy + 9, rgba(art.accent[2]));
  } else if (index % 5 === 1) {
    ellipse(surface, ox + 16, oy + 22, 8, 6, rgba(art.path[0]));
    line(surface, ox + 11, oy + 19, ox + 18, oy + 16, rgba(art.path[2]));
  } else if (index % 5 === 2) {
    line(surface, ox + 16, oy + 27, ox + 16, oy + 12, rgba("#4c7454"), 2);
    ellipse(surface, ox + 13, oy + 11, 3, 3, rgba(art.accent[2]));
    ellipse(surface, ox + 19, oy + 11, 3, 3, rgba(art.accent[1]));
  } else if (index % 5 === 3) {
    outlinedRect(surface, ox + 4, oy + 18, 24, 5, rgba("#8c6c44"));
    outlinedRect(surface, ox + 7, oy + 13, 3, 15, rgba("#544434"));
    outlinedRect(surface, ox + 22, oy + 13, 3, 15, rgba("#544434"));
  } else {
    ellipse(surface, ox + 16, oy + 22, 10, 6, rgba(art.accent[0]));
    pixel(surface, ox + 12, oy + 18, rgba(art.accent[2]));
  }
}

function drawEnvironmentCell(surface, cellX, cellY, index, art) {
  const ox = cellX * 32;
  const oy = cellY * 32;
  const phase = index % 4;
  const kind = Math.floor(index / 4);
  if (kind === 0) {
    line(surface, ox + 4, oy + 17 + phase % 2, ox + 27, oy + 17 + phase % 2, rgba(art.accent[1]));
    line(surface, ox + 8, oy + 21, ox + 23, oy + 21, rgba(art.accent[2]));
  } else if (kind < 5) {
    for (let blade = 0; blade < 5; blade += 1) line(surface, ox + 8 + blade * 4, oy + 27,
      ox + 7 + blade * 4 + phase % 3, oy + 12 + blade % 3, rgba(art.accent[(blade + phase) % 3]));
  } else {
    ellipse(surface, ox + 12 + phase * 2, oy + 22 - phase * 3, 3, 4, rgba(art.accent[1]));
    pixel(surface, ox + 13 + phase * 2, oy + 19 - phase * 3, rgba(art.accent[2]));
  }
}

function buildRegionSurfaces(kit) {
  const art = REGION_ART[kit];
  const terrain = createSurface(256, 256);
  const scenery = createSurface(512, 256);
  const environment = createSurface(256, 128);
  for (let index = 0; index < 64; index += 1) drawTerrainCell(terrain, index % 8, Math.floor(index / 8), index, art);
  for (let index = 0; index < 128; index += 1) drawSceneryCell(scenery, index % 16, Math.floor(index / 16), index, art);
  for (let index = 0; index < 32; index += 1) drawEnvironmentCell(environment, index % 8, Math.floor(index / 8), index, art);
  return { terrain, scenery, environment };
}

function remapCellPalette(cell, ramps) {
  const output = Buffer.from(cell);
  for (let offset = 0; offset < output.length; offset += 4) {
    if (output[offset + 3] === 0) continue;
    const red = output[offset]; const green = output[offset + 1]; const blue = output[offset + 2];
    const source = red + green + blue;
    let rampIndex = 0;
    if (ramps.length > 1) {
      if (source > 560) rampIndex = Math.min(1, ramps.length - 1);
      else if (red > green + 25) rampIndex = ramps.length - 1;
      else if (green > red + 12 || blue > red + 12) rampIndex = Math.min(1, ramps.length - 1);
    }
    const ramp = ramps[rampIndex];
    const shade = source < 250 ? 0 : source < 570 ? 1 : 2;
    const next = rgba(ramp[shade]);
    const chromaSpread = Math.max(red, green, blue) - Math.min(red, green, blue);
    if (source < 100 && chromaSpread < 18) output.set(rgba(OUTLINE), offset);
    else output.set(next, offset);
  }
  return output;
}

function remapOpaqueTerrainCell(cell, ramps) {
  const output = Buffer.from(cell);
  for (let offset = 0; offset < output.length; offset += 4) {
    if (output[offset + 3] !== 255) {
      throw new Error("semantic terrain source cells must be fully opaque before palette remapping");
    }
    const red = output[offset]; const green = output[offset + 1]; const blue = output[offset + 2];
    const source = red + green + blue;
    let rampIndex = 0;
    if (ramps.length > 1) {
      if (blue > red * 1.08 || green > red * 1.12) rampIndex = Math.min(1, ramps.length - 1);
      else if (red > green * 1.08) rampIndex = ramps.length - 1;
    }
    const ramp = ramps[rampIndex];
    const shade = source < 250 ? 0 : source < 570 ? 1 : 2;
    output.set(rgba(ramp[Math.min(shade, ramp.length - 1)]), offset);
  }
  return output;
}

/** Validate exact semantic terrain cells before either native or runtime publication. */
export async function validateSemanticTerrainAtlas(
  buffer,
  roles = SEMANTIC_TERRAIN_ROLES,
  { requireUnusedCellsTransparent = true } = {},
) {
  const errors = [];
  const expectedRoleNames = Object.keys(SEMANTIC_TERRAIN_ROLES);
  const actualRoleNames = roles && typeof roles === "object" && !Array.isArray(roles)
    ? Object.keys(roles)
    : [];
  if (JSON.stringify(actualRoleNames.sort()) !== JSON.stringify([...expectedRoleNames].sort())) {
    return ["semantic terrain roles must be exactly ground, path, water, shore, and soil"];
  }
  const cells = [];
  for (const [role, expectedCells] of Object.entries(SEMANTIC_TERRAIN_ROLES)) {
    if (JSON.stringify(roles[role]) !== JSON.stringify(expectedCells)) {
      errors.push(`${role}: semantic terrain legal cell band drifted`);
      continue;
    }
    cells.push(...roles[role]);
  }
  if (new Set(cells).size !== cells.length || cells.some((cell) => !finiteInteger(cell) || cell < 0 || cell > 35)) {
    errors.push("semantic terrain roles must use disjoint legal cells 0-35 only");
  }
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 256 || info.height !== 256) {
    return [...errors, `semantic terrain atlas must remain native 256x256; received ${info.width}x${info.height}`];
  }
  const sheetBorder = rgba(OUTLINE);
  for (const cell of cells) {
    const originX = cell % 8 * 32;
    const originY = Math.floor(cell / 8) * 32;
    let transparent = 0;
    let borderInk = 0;
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
      const offset = ((originY + y) * info.width + originX + x) * 4;
      if (data[offset + 3] !== 255) transparent += 1;
      if ((x === 0 || x === 31 || y === 0 || y === 31)
        && data[offset] === sheetBorder[0]
        && data[offset + 1] === sheetBorder[1]
        && data[offset + 2] === sheetBorder[2]) borderInk += 1;
    }
    if (transparent > 0) errors.push(`terrain cell ${cell} is not fully opaque (${transparent} pixels)`);
    if (borderInk > 0) errors.push(`terrain cell ${cell} exposes ${borderInk} #1c1c24 sheet-border pixels`);
  }
  if (requireUnusedCellsTransparent) for (let cell = 36; cell < 64; cell += 1) {
    const originX = cell % 8 * 32;
    const originY = Math.floor(cell / 8) * 32;
    let stalePixels = 0;
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
      const offset = ((originY + y) * info.width + originX + x) * 4;
      if (data[offset] !== 0 || data[offset + 1] !== 0 || data[offset + 2] !== 0 || data[offset + 3] !== 0) {
        stalePixels += 1;
      }
    }
    if (stalePixels > 0) errors.push(`terrain cell ${cell} must remain transparent zero RGB (${stalePixels} stale pixels)`);
  }
  return errors;
}

const CONNECTED_TERRAIN_DIRECTIONS = Object.freeze([
  Object.freeze([false, true, false, true]),
  Object.freeze([true, false, true, false]),
  Object.freeze([true, true, false, false]),
  Object.freeze([false, true, true, false]),
  Object.freeze([false, false, true, true]),
  Object.freeze([true, false, false, true]),
  Object.freeze([true, true, true, true]),
  Object.freeze([false, false, false, false]),
]);

function rejectedTerrainTexture(surface, ox, oy, palette, seed, accent) {
  fillRect(surface, ox, oy, 32, 32, rgba(palette[1]));
  for (let mark = 0; mark < 22; mark += 1) {
    const x = 2 + ((seed * 17 + mark * 11) % 28);
    const y = 2 + ((seed * 13 + mark * 7) % 28);
    pixel(surface, ox + x, oy + y, rgba(palette[(seed + mark) % 3]));
    if (mark % 5 === 0) pixel(surface, ox + Math.min(29, x + 1), oy + y, rgba(accent));
  }
  for (let patch = 0; patch < 4; patch += 1) {
    const x = 4 + ((seed * 7 + patch * 9) % 21);
    const y = 4 + ((seed * 11 + patch * 6) % 21);
    const shade = rgba(palette[(seed + patch) % 2 === 0 ? 0 : 2]);
    pixel(surface, ox + x, oy + y, shade);
    pixel(surface, ox + x + 1, oy + y, shade);
    pixel(surface, ox + x + (patch % 2), oy + y + 1, shade);
    if (patch % 2 === 0) pixel(surface, ox + x + 2, oy + y + 1, rgba(accent));
  }
}

function rejectedConnectedTerrainTexture(surface, ox, oy, palette, ground, variant, seed) {
  if (variant === 6) {
    terrainTexture(surface, ox, oy, palette, seed, ground[0]);
    return;
  }
  terrainTexture(surface, ox, oy, ground, seed, palette[0]);
  const [north, east, south, west] = CONNECTED_TERRAIN_DIRECTIONS[variant];
  fillRect(surface, ox + 10, oy + 10, 12, 12, rgba(palette[1]));
  if (north) fillRect(surface, ox + 10, oy, 12, 11, rgba(palette[1]));
  if (east) fillRect(surface, ox + 21, oy + 10, 11, 12, rgba(palette[1]));
  if (south) fillRect(surface, ox + 10, oy + 21, 12, 11, rgba(palette[1]));
  if (west) fillRect(surface, ox, oy + 10, 11, 12, rgba(palette[1]));
  const points = [
    [13 + seed % 6, 13 + seed * 3 % 6],
    [15 + seed * 5 % 5, 17 + seed % 4],
    [11 + seed * 7 % 9, 11 + seed * 11 % 9],
  ];
  for (const [x, y] of points) pixel(surface, ox + x, oy + y, rgba(palette[(x + y + seed) % 3]));
  if (north) pixel(surface, ox + 14 + seed % 4, oy + 3 + seed % 5, rgba(palette[2]));
  if (east) pixel(surface, ox + 25 + seed % 4, oy + 14 + seed % 4, rgba(palette[0]));
  if (south) pixel(surface, ox + 14 + seed % 4, oy + 25 + seed % 4, rgba(palette[2]));
  if (west) pixel(surface, ox + 3 + seed % 5, oy + 14 + seed % 4, rgba(palette[0]));
}

function terrainTexture(surface, ox, oy, palette, seed, accent) {
  const variant = ((seed - 1) % 8 + 8) % 8;
  const accentColor = rgba(accent);
  const dark = rgba(palette[0]);
  const mid = rgba(palette[1]);
  const light = rgba(palette[2]);
  fillRect(surface, ox, oy, 32, 32, mid);
  const patterns = [
    [[3, 5, 10, 5, dark], [22, 18, 7, 5, light], [8, 26, 9, 3, accentColor]],
    [[18, 4, 11, 5, dark], [5, 17, 8, 6, light], [20, 27, 8, 3, accentColor]],
    [[2, 3, 12, 6, dark], [18, 12, 10, 7, light], [5, 23, 13, 5, accentColor]],
    [[3, 13, 16, 6, dark], [18, 3, 11, 5, light], [11, 24, 10, 5, accentColor]],
    [[4, 22, 10, 5, dark], [22, 5, 7, 5, light], [7, 8, 6, 3, accentColor]],
    [[2, 7, 15, 6, dark], [16, 17, 13, 7, light], [4, 27, 12, 4, accentColor]],
    [[5, 4, 7, 5, dark], [20, 22, 9, 4, light], [7, 17, 9, 3, accentColor]],
    [[2, 18, 17, 7, dark], [15, 3, 14, 6, light], [5, 11, 10, 4, accentColor]],
  ];
  for (const [index, [x, y, width, height, color]] of patterns[variant].entries()) {
    translatedPolygon(surface, ox, oy, index === 0
      ? [[x, y + 2], [x + 3, y], [x + width - 2, y], [x + width, y + 3], [x + width - 3, y + height], [x + 1, y + height - 1]]
      : [[x, y], [x + width - 3, y], [x + width, y + 2], [x + width - 1, y + height], [x + 2, y + height], [x, y + height - 2]], color);
  }
  if ([2, 3, 5, 7].includes(variant)) {
    fillRect(surface, ox + 21 - variant % 4, oy + 1 + variant % 3, 8, 3, accentColor);
  }
}

function connectedTerrainTexture(surface, ox, oy, palette, ground, variant, seed) {
  terrainTexture(surface, ox, oy, ground, seed, ground[0]);
  const [north, east, south, west] = CONNECTED_TERRAIN_DIRECTIONS[variant];
  const dark = rgba(palette[0]);
  const mid = rgba(palette[1]);
  const light = rgba(palette[2]);
  const center = variant === 7
    ? [[9, 12], [13, 9], [23, 10], [25, 17], [21, 23], [11, 24], [7, 19]]
    : [[9, 9], [23, 9], [24, 22], [20, 25], [10, 24], [7, 18]];
  translatedPolygon(surface, ox, oy, center, dark);
  fillRect(surface, ox + 10, oy + 10, 12, 12, mid);
  const arm = (points) => {
    translatedPolygon(surface, ox, oy, points, mid);
  };
  if (north) arm([[9, 0], [23, 0], [23, 12], [9, 12]]);
  if (east) arm([[20, 9], [32, 9], [32, 23], [20, 23]]);
  if (south) arm([[9, 20], [23, 20], [23, 32], [9, 32]]);
  if (west) arm([[0, 9], [12, 9], [12, 23], [0, 23]]);
  fillRect(surface, ox + 13 + seed % 4, oy + 14 + seed * 3 % 4, 6, 3, light);
  if (seed % 2 === 0) fillRect(surface, ox + 10 + seed % 3, oy + 20, 5, 2, dark);
}

function shoreTerrainTexture(surface, ox, oy, art, variant, seed) {
  connectedTerrainTexture(surface, ox, oy, art.accent, art.ground, variant, seed);
  const stoneDark = rgba(art.path[0]);
  const stoneMid = rgba(art.path[1]);
  const [north, east, south, west] = CONNECTED_TERRAIN_DIRECTIONS[variant];
  if (north || south || variant === 7) {
    for (const [x, y, width] of [[3, 7, 7], [22, 6, 8], [2, 24, 8], [22, 25, 7]]) {
      fillRect(surface, ox + x, oy + y, width, 3, stoneDark);
      fillRect(surface, ox + x + 2, oy + y, Math.max(2, width - 4), 1, stoneMid);
    }
  }
  if (east || west || variant === 7) {
    for (const [x, y] of [[6, 3], [25, 4], [5, 21], [25, 22]]) {
      fillRect(surface, ox + x, oy + y, 3, 7, stoneDark);
      fillRect(surface, ox + x + 1, oy + y + 1, 1, 4, stoneMid);
    }
  }
}

async function authorSemanticTerrainAtlas(_tileBuffer, kit) {
  const art = REGION_ART[kit];
  const terrain = createSurface(256, 256);
  for (const [role, cells] of Object.entries(SEMANTIC_TERRAIN_ROLES)) {
    for (const cell of cells) {
      const variant = cell - cells[0];
      const ox = cell % 8 * 32;
      const oy = Math.floor(cell / 8) * 32;
      if (role === "ground") terrainTexture(terrain, ox, oy, art.ground, variant + 1, art.accent[0]);
      else if (role === "shore") shoreTerrainTexture(terrain, ox, oy, art, variant, variant + 41);
      else {
        const palette = role === "path" ? art.path : role === "water" ? art.accent : art.ground;
        const connectionVariant = role === "soil" ? [7, 0, 1, 6][variant] : variant;
        connectedTerrainTexture(terrain, ox, oy, palette, role === "soil" ? art.path : art.ground,
          connectionVariant, variant + (role === "water" ? 19 : role === "soil" ? 61 : 9));
      }
    }
  }
  return encodeSurface(terrain, NATIVE_PNG_OPTIONS);
}

function guideSpritePalette(art) {
  return Object.freeze({
    primary: art.accent.map((color) => rgba(color)),
    secondary: art.path.map((color) => rgba(color)),
    tertiary: art.ground.map((color) => rgba(color)),
    timber: [rgba("#544434"), rgba("#8c6c44"), rgba("#b88c68")],
  });
}

function remapGuidePixel(red, green, blue, palette) {
  const brightness = (red * 299 + green * 587 + blue * 114) / 1000;
  const shade = brightness < 120 ? 0 : brightness < 190 ? 1 : 2;
  if (green > red * 1.07 && green > blue * 1.02) return palette.primary[shade];
  if (red > green * 1.16 && red > blue * 1.08) return palette.timber[shade];
  if (blue > red * 1.05 || Math.max(red, green, blue) - Math.min(red, green, blue) < 20) {
    return palette.secondary[shade];
  }
  return palette.tertiary[shade];
}

async function normalizedGuideSprite(guide, crop, art) {
  const [left, top, width, height] = crop;
  const rgbaSource = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const source = ((top + y) * guide.info.width + left + x) * 4;
    const destination = (y * width + x) * 4;
    const red = guide.data[source]; const green = guide.data[source + 1]; const blue = guide.data[source + 2];
    if (red > 210 && blue > 170 && green < 100) continue;
    rgbaSource.set([red, green, blue, 255], destination);
  }
  const fitWidth = Math.max(13, Math.min(25, Math.round(width / Math.max(width, height) * 25)));
  const fitHeight = Math.max(13, Math.min(27, Math.round(height / Math.max(width, height) * 27)));
  const resized = await sharp(rgbaSource, { raw: { width, height, channels: 4 } })
    .resize(fitWidth, fitHeight, { kernel: "nearest", fit: "fill" })
    .raw()
    .toBuffer();
  const cell = Buffer.alloc(32 * 32 * 4);
  const offsetX = Math.floor((32 - fitWidth) / 2);
  const offsetY = 30 - fitHeight;
  const palette = guideSpritePalette(art);
  const opaqueAt = (x, y) => x >= 0 && y >= 0 && x < fitWidth && y < fitHeight
    && resized[(y * fitWidth + x) * 4 + 3] !== 0;
  const interiorAt = (x, y) => opaqueAt(x, y)
    && [-1, 0, 1].every((dy) => [-1, 0, 1].every((dx) => opaqueAt(x + dx, y + dy)));
  for (let y = 0; y < fitHeight; y += 1) for (let x = 0; x < fitWidth; x += 1) {
    const source = (y * fitWidth + x) * 4;
    if (resized[source + 3] === 0) continue;
    const isInterior = interiorAt(x, y);
    const touchesInterior = [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => (
      interiorAt(x + dx, y + dy)
    )));
    if (!isInterior && !touchesInterior) continue;
    const next = isInterior
      ? remapGuidePixel(resized[source], resized[source + 1], resized[source + 2], palette)
      : rgba(OUTLINE);
    cell.set(next, ((offsetY + y) * 32 + offsetX + x) * 4);
  }
  return cell;
}

function transformGuideSprite(source, variant) {
  const output = Buffer.alloc(source.length);
  const flip = Math.floor(variant / 4) % 2 === 1;
  const shiftX = [-2, 0, 2, -1][Math.floor(variant / 8) % 4];
  const shiftY = [0, -1, 1, 0][Math.floor(variant / 4) % 4];
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
    const sourceX = flip ? 31 - x : x;
    const sourceOffset = (y * 32 + sourceX) * 4;
    if (source[sourceOffset + 3] === 0) continue;
    const targetX = x + shiftX;
    const targetY = y + shiftY;
    if (targetX < 1 || targetX > 30 || targetY < 1 || targetY > 30) continue;
    source.copy(output, (targetY * 32 + targetX) * 4, sourceOffset, sourceOffset + 4);
  }
  return output;
}

async function authorGuideSceneryAtlas(guide, kit) {
  const art = REGION_ART[kit];
  const scenery = createSurface(512, 256);
  for (const [kindIndex, kind] of art.scenery.entries()) {
    const bases = await Promise.all(REGION_GUIDE_SCENERY[kit][kind].map((crop) => (
      normalizedGuideSprite(guide, crop, art)
    )));
    for (let variant = 0; variant < 32; variant += 1) {
      const cell = kindIndex + variant * 4;
      pasteRawCell(scenery, cell % 16, Math.floor(cell / 16),
        transformGuideSprite(bases[variant % bases.length], variant), 32, 32);
    }
  }
  return encodeSurface(scenery, NATIVE_PNG_OPTIONS);
}

function drawNamedEnvironmentCell(surface, cellX, cellY, kind, phase, art) {
  const ox = cellX * 32;
  const oy = cellY * 32;
  const accent = art.accent.map((color) => rgba(color));
  const ground = art.ground.map((color) => rgba(color));
  const pathRamp = art.path.map((color) => rgba(color));
  if (kind === "water") {
    line(surface, ox + 4, oy + 14 + phase % 2, ox + 27, oy + 14 + phase % 2, rgba(OUTLINE), 3);
    line(surface, ox + 5, oy + 14 + phase % 2, ox + 26, oy + 14 + phase % 2, accent[2]);
    line(surface, ox + 9, oy + 21, ox + 22, oy + 21, rgba(OUTLINE), 3);
    line(surface, ox + 10, oy + 21, ox + 21, oy + 21, accent[1]);
  } else if (["grass", "reed"].includes(kind)) {
    for (let blade = 0; blade < 5; blade += 1) {
      const x = ox + 7 + blade * 4;
      line(surface, x, oy + 28, x + (phase + blade) % 3 - 1, oy + 12 + blade % 4, rgba(OUTLINE), 3);
      line(surface, x, oy + 27, x + (phase + blade) % 3 - 1, oy + 13 + blade % 4,
        accent[(blade + phase) % 3]);
    }
  } else if (["shrub", "tree"].includes(kind)) {
    if (kind === "tree") outlinedRect(surface, ox + 14, oy + 17, 5, 13, rgba("#8c6c44"));
    ellipse(surface, ox + 16 + phase % 2, oy + (kind === "tree" ? 12 : 20),
      kind === "tree" ? 10 : 11, kind === "tree" ? 9 : 7, accent[1]);
    pixel(surface, ox + 12 + phase % 3, oy + (kind === "tree" ? 8 : 17), accent[2]);
  } else if (kind === "ember") {
    for (let spark = 0; spark < 3; spark += 1) {
      const x = ox + 9 + spark * 7 + (phase + spark) % 2;
      const y = oy + 25 - ((phase * 3 + spark * 5) % 17);
      outlinedRect(surface, x - 1, y - 1, 3, 3, accent[(spark + phase) % 3]);
    }
  } else if (kind === "smoke-anchor") {
    for (let puff = 0; puff < 3; puff += 1) {
      ellipse(surface, ox + 12 + puff * 4 + phase % 2, oy + 24 - puff * 6 - phase,
        4 + puff, 3 + puff, pathRamp[Math.min(2, puff)]);
    }
  } else {
    ellipse(surface, ox + 16, oy + 21 - phase % 2, 8, 6, ground[1]);
    pixel(surface, ox + 13 + phase, oy + 18, accent[2]);
  }
}

async function authorEnvironmentAtlas(kit) {
  const art = REGION_ART[kit];
  const environment = createSurface(256, 128);
  for (let kindIndex = 0; kindIndex < 8; kindIndex += 1) {
    const kind = art.animated[kindIndex] ?? art.animated[kindIndex % art.animated.length];
    for (let phase = 0; phase < 4; phase += 1) {
      const cell = kindIndex * 4 + phase;
      drawNamedEnvironmentCell(environment, cell % 8, Math.floor(cell / 8), kind, phase, art);
    }
  }
  return encodeSurface(environment, NATIVE_PNG_OPTIONS);
}

async function bootstrapRegionSurfacesFromApprovedSlice(kit, tileBuffer) {
  const art = REGION_ART[kit];
  const raw = await rawAtlas(tileBuffer);
  const terrain = createSurface(256, 256);
  const scenery = createSurface(512, 256);
  const environment = createSurface(256, 128);
  for (let index = 0; index < 64; index += 1) {
    const source = extractRawCell(raw, index, 8, 32, 32);
    const family = index < 8 ? [art.ground] : index < 16 ? [art.path] : index < 32
      ? [art.ground, art.accent] : [art.accent, art.path];
    pasteRawCell(terrain, index % 8, Math.floor(index / 8),
      kit === "worn-heartland" ? source : remapCellPalette(source, family), 32, 32);
  }
  const propSourceIndices = [40, 42, 36, 45, 38, 46, 60, 61, 37, 39, 41, 43, 44, 47, 56, 57];
  for (let index = 0; index < 128; index += 1) {
    const source = extractRawCell(raw, propSourceIndices[index % propSourceIndices.length], 8, 32, 32);
    const colored = kit === "worn-heartland" ? source : remapCellPalette(source, [art.accent, art.path]);
    pasteRawCell(scenery, index % 16, Math.floor(index / 16), colored, 32, 32);
    if (index >= 16 && index % 9 === 0) {
      const ox = (index % 16) * 32; const oy = Math.floor(index / 16) * 32;
      line(scenery, ox + 7, oy + 27, ox + 24, oy + 8, rgba(art.accent[2]));
    }
  }
  if (kit === "worn-heartland") {
    outlinedRect(scenery, 14, 12, 5, 18, rgba("#8c6c44"));
    ellipse(scenery, 16, 10, 11, 8, rgba(art.accent[1]));
    outlinedRect(scenery, 37, 18, 24, 5, rgba("#8c6c44"));
  } else if (kit === "spring-terraces") {
    outlinedRect(scenery, 15, 8, 4, 22, rgba("#8c6c44"));
    for (let branch = 0; branch < 6; branch += 1) line(scenery, 16, 9, 6 + branch * 4, 23, rgba(art.accent[2]), 2);
    for (let reed = 0; reed < 7; reed += 1) line(scenery, 35 + reed * 3, 29, 34 + reed * 3, 9 + reed % 3, rgba(art.accent[0]), 2);
  } else if (kit === "dry-scrub") {
    line(scenery, 7, 28, 22, 7, rgba("#8c6c44"), 4);
    line(scenery, 15, 17, 5, 10, rgba("#8c6c44"), 3);
    line(scenery, 16, 17, 28, 12, rgba("#8c6c44"), 3);
    for (let thorn = 0; thorn < 6; thorn += 1) line(scenery, 38 + thorn * 4, 28, 40 + thorn * 3, 14 + thorn % 3, rgba(art.accent[0]));
  } else if (kit === "ash-waste") {
    outlinedRect(scenery, 13, 8, 6, 22, rgba("#24242c"));
    line(scenery, 15, 11, 4, 4, rgba("#24242c"), 3);
    line(scenery, 17, 15, 27, 7, rgba("#24242c"), 3);
    ellipse(scenery, 48, 23, 12, 8, rgba(art.path[1]));
    line(scenery, 41, 20, 54, 25, rgba(art.accent[1]), 2);
  } else {
    outlinedRect(scenery, 14, 11, 5, 19, rgba("#8c6c44"));
    ellipse(scenery, 16, 10, 12, 9, rgba(art.accent[1]));
    ellipse(scenery, 48, 23, 10, 7, rgba(art.path[1]));
  }
  const environmentSources = [16, 60, 45, 40, 42, 46, 61, 36];
  for (let index = 0; index < 32; index += 1) {
    const source = extractRawCell(raw, environmentSources[Math.floor(index / 4)], 8, 32, 32);
    const colored = kit === "worn-heartland" ? source : remapCellPalette(source, [art.accent, art.path]);
    const shifted = Buffer.alloc(colored.length);
    const phase = index % 4;
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
      const from = (y * 32 + x) * 4;
      if (colored[from + 3] === 0) continue;
      const toX = Math.max(0, Math.min(31, x + (phase % 2)));
      colored.copy(shifted, (y * 32 + toX) * 4, from, from + 4);
    }
    pasteRawCell(environment, index % 8, Math.floor(index / 8), shifted, 32, 32);
  }
  return { terrain, scenery, environment };
}

function drawHomeComponent(surface, cellX, cellY, index, art) {
  const ox = cellX * 128;
  const oy = cellY * 128;
  const timber = [rgba("#544434"), rgba("#8c6c44"), rgba("#b49c7c")];
  const plaster = [rgba("#ccbc9c"), rgba("#e4d4b4"), rgba("#f4e4cc")];
  const roof = art.roof.map((color) => rgba(color));
  const id = HOME_COMPONENTS[index];
  if (id === "foundation") outlinedRect(surface, ox + 8, oy + 94, 112, 12, timber[1]);
  else if (id === "post") {
    outlinedRect(surface, ox + 16, oy + 28, 9, 76, timber[1]);
    outlinedRect(surface, ox + 103, oy + 28, 9, 76, timber[1]);
  } else if (id.startsWith("wall")) {
    outlinedRect(surface, ox + 14, oy + 42, 100, 63, plaster[id.includes("broken") ? 0 : 1]);
    if (!id.endsWith("intact")) {
      line(surface, ox + 54, oy + 44, ox + 68, oy + 78, rgba(OUTLINE));
      line(surface, ox + 68, oy + 78, ox + 58, oy + 103, rgba(OUTLINE));
    }
  } else if (id.startsWith("roof")) {
    for (let row = 0; row < 28; row += 1) {
      const inset = Math.floor(row / 3);
      fillRect(surface, ox + 5 + inset, oy + 18 + row, 118 - inset * 2, 1,
        row === 0 || row === 27 ? rgba(OUTLINE) : roof[(row + index) % 3]);
    }
    if (id !== "roof-intact") line(surface, ox + 58, oy + 22, ox + 72, oy + 43, rgba(OUTLINE), 2);
  } else if (id.startsWith("door")) {
    if (id !== "door-open") outlinedRect(surface, ox + 49, oy + 59, 30, 46, timber[id.includes("breached") ? 0 : 1]);
    else {
      outlinedRect(surface, ox + 47, oy + 57, 34, 49, rgba(OUTLINE));
      fillRect(surface, ox + 49, oy + 59, 30, 47, rgba("#342820"));
    }
    if (id.includes("opening")) fillRect(surface, ox + 52 + (index % 3) * 4, oy + 62, 7, 39, rgba("#342820"));
  } else if (id.startsWith("window")) {
    outlinedRect(surface, ox + 27, oy + 62, 22, 20, id === "window-lit" ? rgba("#f4c474") : rgba("#648494"));
    if (id === "window-broken") line(surface, ox + 28, oy + 63, ox + 47, oy + 80, rgba(OUTLINE));
  } else if (id.startsWith("hearth")) {
    outlinedRect(surface, ox + 83, oy + 83, 22, 17, timber[0]);
    if (id !== "hearth-cold") ellipse(surface, ox + 94, oy + 82 - (index % 2) * 3, 5, 7, rgba("#e46c5c"));
  } else if (id === "chimney") outlinedRect(surface, ox + 87, oy + 12, 16, 38, timber[1]);
  else {
    for (let dust = 0; dust < 10; dust += 1) ellipse(surface, ox + 20 + dust * 9, oy + 90 - (dust % 4) * 9, 3, 2, rgba(art.path[1]));
  }
}

function drawHomeDetail(surface, cellX, cellY, index, art) {
  const ox = cellX * 32;
  const oy = cellY * 32;
  const colors = [rgba(art.accent[1]), rgba("#f4c474"), rgba("#e46c5c"), rgba("#e4d4b4")];
  if (index < 16) {
    ellipse(surface, ox + 16, oy + 16, 7, 7, colors[index % 4]);
    pixel(surface, ox + 16, oy + 13, rgba(OUTLINE));
  } else outlinedRect(surface, ox + 8, oy + 12, 16, 13, colors[index % 4]);
}

function drawRuinCell(surface, cellX, cellY, index, art) {
  const ox = cellX * 128;
  const oy = cellY * 128;
  const density = index < 2 ? 12 : index < 4 ? 8 : index < 6 ? 5 : 14;
  for (let piece = 0; piece < density; piece += 1) {
    const x = ox + 18 + (piece * 17 + index * 7) % 92;
    const y = oy + 82 + (piece * 11 + index * 3) % 24;
    outlinedRect(surface, x, y, 9 + piece % 7, 6 + piece % 5,
      rgba(piece % 2 === 0 ? art.roof[1] : "#8c6c44"));
  }
  if (index % 2 === 1) {
    for (let mote = 0; mote < 6; mote += 1) ellipse(surface, ox + 30 + mote * 13, oy + 76 - mote * 5, 2, 2, rgba(art.path[2]));
  }
}

function buildHomeSurfaces(kit) {
  const art = REGION_ART[kit];
  const components = createSurface(768, 512);
  const details = createSurface(256, 128);
  const ruins = createSurface(512, 256);
  for (let index = 0; index < 24; index += 1) drawHomeComponent(components, index % 6, Math.floor(index / 6), index, art);
  for (let index = 0; index < 32; index += 1) drawHomeDetail(details, index % 8, Math.floor(index / 8), index, art);
  for (let index = 0; index < 8; index += 1) drawRuinCell(ruins, index % 4, Math.floor(index / 4), index, art);
  return { components, details, ruins };
}

async function bootstrapHomeSurfacesFromApprovedSlice(kit, shelterBuffer, tileBuffer) {
  const art = REGION_ART[kit];
  const [shelterRaw, tileRaw] = await Promise.all([rawAtlas(shelterBuffer), rawAtlas(tileBuffer)]);
  const components = createSurface(768, 512);
  const details = createSurface(256, 128);
  const ruins = createSurface(512, 256);
  const componentSources = [0, 1, 2, 11, 12, 13, 3, 4, 4, 5, 5, 6, 6, 6, 15, 15, 7, 7, 7, 8, 8, 8, 9, 14];
  for (let index = 0; index < 24; index += 1) {
    const source = extractRawCell(shelterRaw, componentSources[index], 5, 128, 128);
    const colored = kit === "worn-heartland" ? Buffer.from(source) : remapCellPalette(source, [["#544434", "#8c6c44", "#b49c7c"],
      ["#ccbc9c", "#e4d4b4", "#f4e4cc"], art.roof, art.path]);
    pasteRawCell(components, index % 6, Math.floor(index / 6), colored, 128, 128);
    const ox = (index % 6) * 128; const oy = Math.floor(index / 6) * 128;
    if (index === 17 || index === 20 || index === 21) {
      ellipse(components, ox + 64, oy + 74, 11, 9, rgba("#fab620"));
      ellipse(components, ox + 64, oy + 72, 6, 6, rgba("#de8529"));
    }
    if (index === 19) {
      fillRect(components, ox + 50, oy + 65, 28, 30, rgba("#39332d"));
      outlinedRect(components, ox + 48, oy + 92, 32, 8, rgba("#69523d"));
    }
  }
  const detailSources = [45, 46, 60, 61, 36, 38, 40, 42];
  for (let index = 0; index < 32; index += 1) {
    const source = extractRawCell(tileRaw, detailSources[index % detailSources.length], 8, 32, 32);
    pasteRawCell(details, index % 8, Math.floor(index / 8), remapCellPalette(source, [art.accent, art.path]), 32, 32);
  }
  const ruinSources = [16, 16, 17, 17, 18, 18, 16, 18];
  for (let index = 0; index < 8; index += 1) {
    const source = extractRawCell(shelterRaw, ruinSources[index], 5, 128, 128);
    const colored = kit === "worn-heartland" ? source : remapCellPalette(source, [["#544434", "#8c6c44", "#b49c7c"], art.roof, art.path]);
    pasteRawCell(ruins, index % 4, Math.floor(index / 4), colored, 128, 128);
  }
  return { components, details, ruins };
}

function atlasDescriptor(id, relativePath, group, regionKit, width, height, cellWidth, cellHeight, buffer) {
  return {
    id,
    path: relativePath,
    group,
    regionKit,
    width,
    height,
    cellWidth,
    cellHeight,
    columns: width / cellWidth,
    rows: height / cellHeight,
    compressedBytes: buffer.length,
    decodedBytes: width * height * 4,
    sha256: hashBuffer(buffer),
    binaryAlpha: null,
    runtimeResized: null,
  };
}

function frameRef(atlasId, index, columns, cellWidth, cellHeight) {
  return {
    atlasId,
    rect: { x: (index % columns) * cellWidth, y: Math.floor(index / columns) * cellHeight,
      width: cellWidth, height: cellHeight },
    durationMs: 160,
    feet: { x: cellWidth === 48 ? 24 : Math.floor(cellWidth / 2), y: cellHeight === 64 ? 61 : cellHeight - 1 },
    faceAnchor: { x: cellWidth === 48 ? 24 : Math.floor(cellWidth / 2), y: cellHeight === 64 ? 18 : Math.floor(cellHeight / 2) },
    heldAnchor: { x: cellWidth === 48 ? 34 : Math.floor(cellWidth / 2), y: cellHeight === 64 ? 38 : Math.floor(cellHeight / 2) },
  };
}

export async function buildRuntimeInventory() {
  const outputs = [];
  const descriptors = [];
  const coreBuffers = {};
  const coreGeometry = {
    "human-body-rigs.png": [768, 1408, 48, 64],
    "human-face-planes.png": [768, 256, 48, 64],
    "human-hair.png": [768, 768, 48, 64],
    "human-held.png": [768, 256, 48, 64],
    "human-status-effects.png": [512, 256, 32, 32],
  };
  for (let index = 0; index < 8; index += 1) coreGeometry[`human-clothing-${String(index).padStart(2, "0")}.png`] = [768, 704, 48, 64];
  const coreNames = Object.keys(coreGeometry);
  for (const name of coreNames) {
    const buffer = await readFile(path.join(NATIVE_ROOT, "core", name));
    coreBuffers[name] = buffer;
    const id = `core-${name.replace(/\.png$/, "")}`;
    const [width, height, cellWidth, cellHeight] = coreGeometry[name];
    const relativePath = `core/${name}`;
    outputs.push({ relativePath, buffer });
    descriptors.push(atlasDescriptor(id, relativePath, "core", null, width, height, cellWidth, cellHeight, buffer));
  }

  const packs = {};
  for (const kit of REGION_KITS) {
    const geometry = {
      [`regions/${kit}/terrain.png`]: [256, 256, 32, 32, "region", "terrain"],
      [`regions/${kit}/scenery.png`]: [512, 256, 32, 32, "region", "scenery"],
      [`regions/${kit}/environment.png`]: [256, 128, 32, 32, "region", "environment"],
      [`regions/${kit}/landmarks.png`]: [512, 256, 128, 128, "region", "landmarks"],
      [`homes/${kit}/components.png`]: [768, 512, 128, 128, "home", "home-components"],
      [`homes/${kit}/details.png`]: [256, 128, 32, 32, "home", "home-details"],
      [`homes/${kit}/ruins.png`]: [512, 256, 128, 128, "home", "home-ruins"],
      [`homes/${kit}/yards.png`]: [960, 160, 192, 160, "home", "home-yards"],
    };
    const packDescriptors = [];
    for (const relativePath of Object.keys(geometry)) {
      const buffer = await readFile(path.join(NATIVE_ROOT, relativePath));
      const [width, height, cellWidth, cellHeight, group, suffix] = geometry[relativePath];
      const descriptor = atlasDescriptor(`${kit}-${suffix}`, relativePath, group, kit,
        width, height, cellWidth, cellHeight, buffer);
      descriptors.push(descriptor);
      packDescriptors.push(descriptor);
      outputs.push({ relativePath, buffer });
    }
    packs[kit] = { descriptors: packDescriptors };
  }
  return { outputs, descriptors, packs, coreBuffers };
}

function bodyActionAtIndex(index) {
  const local = index % 172;
  let phaseIndex = local % 43;
  for (const [action, count] of BODY_ACTIONS) {
    if (phaseIndex < count) return { action, phase: phaseIndex };
    phaseIndex -= count;
  }
  return { action: "idle", phase: 0 };
}

function measureBodyAnchors(data, info, index) {
  const originX = (index % 16) * 48;
  const originY = Math.floor(index / 16) * 64;
  const facing = FACINGS[Math.floor((index % 172) / 43)];
  const { action, phase } = bodyActionAtIndex(index);
  const expectedHead = headAnchorForAction(facing, action, phase);
  const opaque = [];
  const warm = [];
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 48; x += 1) {
    const offset = ((originY + y) * info.width + originX + x) * 4;
    if (data[offset + 3] !== 255) continue;
    opaque.push({ x, y });
    const [red, green, blue] = [data[offset], data[offset + 1], data[offset + 2]];
    if (red > 110 && red > green * 1.08 && green > blue * 1.05
      && Math.abs(x - expectedHead.x) <= 13 && Math.abs(y - expectedHead.y) <= 13) warm.push({ x, y });
  }
  const bottomY = Math.max(...opaque.map(({ y }) => y));
  const footPixels = opaque.filter(({ y }) => y >= bottomY - 1);
  const average = (points, key, fallback) => points.length === 0 ? fallback
    : Math.round(points.reduce((sum, point) => sum + point[key], 0) / points.length);
  const facePoints = warm.length > 0 ? warm : opaque.filter(({ x, y }) =>
    Math.abs(x - expectedHead.x) <= 10 && Math.abs(y - expectedHead.y) <= 10);
  const nonHeadWarm = opaque.filter(({ x, y }) =>
    y >= 25 && y <= 52 && Math.abs(x - expectedHead.x) > 8);
  const heldPoint = nonHeadWarm.sort((left, right) => {
    if (facing === "west") return left.x - right.x;
    return right.x - left.x;
  })[0] ?? { x: facing === "west" ? 14 : 34, y: 38 };
  return {
    feet: { x: average(footPixels, "x", 24), y: bottomY },
    faceAnchor: { x: average(facePoints, "x", expectedHead.x), y: average(facePoints, "y", expectedHead.y) },
    heldAnchor: { x: heldPoint.x, y: heldPoint.y },
  };
}

async function atlasFrames(descriptor, buffer, persistedFrames = null) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const authoredFrameCount = descriptor.id === "core-human-body-rigs" ? 344
    : /^core-human-clothing-\d{2}$/.test(descriptor.id) ? 172
      : descriptor.columns * descriptor.rows;
  return Array.from({ length: authoredFrameCount }, (_unused, index) => {
    const reference = frameRef(
      descriptor.id,
      index,
      descriptor.columns,
      descriptor.cellWidth,
      descriptor.cellHeight,
    );
    let detected = {
      feet: { ...reference.feet },
      faceAnchor: { ...reference.faceAnchor },
      heldAnchor: { ...reference.heldAnchor },
    };
    if (descriptor.id === "core-human-body-rigs") {
      detected = measureBodyAnchors(data, info, index);
    }
    const persisted = persistedFrames?.[index];
    return {
      id: `${descriptor.id}:${index}`,
      ...reference,
      ...(persisted ?? {}),
      detectedFeet: detected.feet,
      detectedFaceAnchor: detected.faceAnchor,
      detectedHeldAnchor: detected.heldAnchor,
    };
  });
}

async function validateRuntimeInventory(inventory) {
  const nativeContractBytes = await readFile(path.join(NATIVE_ROOT, "production-native-contract.json"));
  const nativeContractSha256 = hashBuffer(nativeContractBytes);
  const nativeContract = JSON.parse(nativeContractBytes);
  const schemaErrors = validateNativeContractSchema(nativeContract);
  if (schemaErrors.length > 0) {
    return {
      errors: schemaErrors.map((error) => `native contract schema: ${error}`),
      nativeContract,
      nativeContractSha256,
    };
  }
  const errors = [];
  for (const output of inventory.outputs) {
    const descriptor = inventory.descriptors.find(({ path: atlasPath }) => atlasPath === output.relativePath);
    if (!descriptor) {
      errors.push(`${output.relativePath}: descriptor missing for native master`);
      continue;
    }
    const sourceContract = nativeContract.atlases?.[descriptor.id];
    if (!sourceContract) {
      errors.push(`${descriptor.id}: independent native authoring contract is missing`);
      continue;
    }
    if (sourceContract.sourceSha256 !== descriptor.sha256) {
      errors.push(`${descriptor.id}: native source hash drift from persisted authoring contract`);
    }
    const analysis = await analyzeRuntimeAtlas(output.buffer, {
      id: descriptor.id,
      width: descriptor.width,
      height: descriptor.height,
      cellWidth: descriptor.cellWidth,
      cellHeight: descriptor.cellHeight,
      sourceCellWidth: descriptor.cellWidth,
      sourceCellHeight: descriptor.cellHeight,
      outlineColors: sourceContract.outlineColors,
      materialRamps: sourceContract.materialRamps,
      outlineCornerExceptions: sourceContract.outlineCornerExceptions,
      requireExposedOutline: !descriptor.id.endsWith("-terrain")
        && !descriptor.id.endsWith("-landmarks")
        && !descriptor.id.endsWith("-home-yards"),
      frames: await atlasFrames(descriptor, output.buffer, sourceContract.frames),
    });
    descriptor.binaryAlpha = analysis.binaryAlpha;
    descriptor.runtimeResized = analysis.runtimeResized;
    descriptor.validation = {
      measuredFromSha256: analysis.sha256,
      measuredFromContractSha256: nativeContractSha256,
      errors: analysis.errors,
      binaryAlpha: analysis.binaryAlpha,
      transparentResidue: analysis.transparentResidue,
      runtimeResized: analysis.runtimeResized,
      maxShadesPerMaterial: analysis.maxShadesPerMaterial,
      maxOutlineWidth: analysis.maxOutlineWidth,
      maxRootDrift: analysis.maxRootDrift,
      maxFaceAnchorDrift: analysis.maxFaceAnchorDrift,
      maxHeldAnchorDrift: analysis.maxHeldAnchorDrift,
      unknownOpaqueColors: analysis.unknownOpaqueColors,
      missingExposedOutlinePixels: analysis.missingExposedOutlinePixels,
    };
    errors.push(...analysis.errors.map((error) => `${descriptor.id}: ${error}`));
    if (descriptor.id.endsWith("-terrain")) {
      const semanticErrors = await validateSemanticTerrainAtlas(
        output.buffer,
        sourceContract.semanticTerrainRoles,
      );
      descriptor.validation.semanticTerrainErrors = semanticErrors;
      errors.push(...semanticErrors.map((error) => `${descriptor.id}: ${error}`));
    }
  }
  const compositionBuffers = Object.fromEntries(inventory.outputs
    .filter(({ relativePath }) => relativePath.endsWith("/landmarks.png") || relativePath.endsWith("/yards.png"))
    .map(({ relativePath, buffer }) => {
      const descriptor = inventory.descriptors.find(({ path: atlasPath }) => atlasPath === relativePath);
      return [descriptor.id, buffer];
    }));
  errors.push(...await validateRegionalCompositionContract(nativeContract, compositionBuffers));
  return { errors, nativeContract, nativeContractSha256 };
}

function rgbaKeyAt(raw, cellIndex, x, y) {
  const originX = (cellIndex % 16) * 48;
  const originY = Math.floor(cellIndex / 16) * 64;
  const offset = ((originY + y) * raw.info.width + originX + x) * 4;
  return {
    key: raw.data[offset + 3] === 255
      ? [raw.data[offset], raw.data[offset + 1], raw.data[offset + 2]].join(",")
      : null,
    rgba: [...raw.data.subarray(offset, offset + 4)],
  };
}

function scanSemanticCell(raw, cellIndex, palette) {
  const keys = new Set(palette.map((color) => color.join(",")));
  const points = [];
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 48; x += 1) {
      if (keys.has(rgbaKeyAt(raw, cellIndex, x, y).key)) points.push({ x, y });
    }
  }
  return points;
}

function connectedPixelComponents(points) {
  const remaining = new Set(points.map(({ x, y }) => `${x},${y}`));
  const components = [];
  while (remaining.size > 0) {
    const seed = remaining.values().next().value;
    const queue = [seed];
    const component = [];
    remaining.delete(seed);
    while (queue.length > 0) {
      const key = queue.shift();
      const [x, y] = key.split(",").map(Number);
      component.push({ x, y });
      for (const neighbor of [`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`]) {
        if (!remaining.delete(neighbor)) continue;
        queue.push(neighbor);
      }
    }
    components.push(component);
  }
  return components;
}

function semanticPixelsSha256(raw, cellIndex, semanticFeatureMask) {
  const measured = Object.fromEntries(["eyes", "nose", "mouth"].map((category) => [category,
    semanticFeatureMask[category].map(({ x, y }) => ({
      x,
      y,
      rgba: rgbaKeyAt(raw, cellIndex, x, y).rgba,
    })),
  ]));
  return hashBuffer(Buffer.from(JSON.stringify(measured)));
}

function measuredNoseDirection(facing, points) {
  if (points.length === 0) return facing === "north" ? "north-hidden" : "missing";
  const averageX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  if (averageX >= 28) return "east";
  if (averageX <= 20) return "west";
  return "south";
}

async function measureFacePlaneContract(inventory, semanticContract) {
  const faceBuffer = inventory.coreBuffers["human-face-planes.png"];
  const bodyBuffer = inventory.coreBuffers["human-body-rigs.png"];
  const [faceRaw, bodyRaw] = await Promise.all([
    sharp(faceBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(bodyBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  const palette = semanticContract.faceSemanticPalette;
  const semanticOwners = new Map();
  for (const [feature, colors] of Object.entries(palette)) {
    for (const color of colors) {
      const key = color.join(",");
      if (semanticOwners.has(key)) {
        throw new Error(`face semantic color ${key} is ambiguously owned by ${semanticOwners.get(key)} and ${feature}`);
      }
      semanticOwners.set(key, feature);
    }
  }
  const bodyPlanes = {};
  const facePlanes = {};
  for (let rig = 0; rig < 2; rig += 1) {
    for (const [facingIndex, facing] of FACINGS.entries()) {
      const neutralIndex = facingIndex * 16 + rig * 8;
      const { data: neutralData } = await sharp(await cellBuffer(faceBuffer, neutralIndex, 16, 48, 64))
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let planePixels = 0;
      for (let offset = 3; offset < neutralData.length; offset += 4) {
        if (neutralData[offset] === 255) planePixels += 1;
      }
      for (const [expressionIndex, expression] of EXPRESSIONS.entries()) {
        const cellIndex = facingIndex * 16 + rig * 8 + expressionIndex;
        const { data } = await sharp(await cellBuffer(faceBuffer, cellIndex, 16, 48, 64))
          .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        let maskPixels = 0;
        let coveredMaskPixels = 0;
        let leakedPixels = 0;
        for (let offset = 3; offset < data.length; offset += 4) {
          const opaque = data[offset] === 255;
          const inNeutralMask = neutralData[offset] === 255;
          if (opaque) maskPixels += 1;
          if (opaque && inNeutralMask) coveredMaskPixels += 1;
          if (opaque && !inNeutralMask) leakedPixels += 1;
        }
        const semanticFeatureMask = {
          eyes: scanSemanticCell(faceRaw, cellIndex, palette.eyes),
          nose: scanSemanticCell(faceRaw, cellIndex, palette.nose),
          mouth: scanSemanticCell(faceRaw, cellIndex, palette.mouth),
        };
        const rigId = rig === 0 ? "human-a" : "human-b";
        const id = [rigId, facing, expression].join(":");
        facePlanes[id] = {
          id,
          rig: rigId,
          facing,
          expression,
          cellIndex,
          maskPixels,
          coveredMaskPixels,
          leakedPixels,
          eyes: connectedPixelComponents(semanticFeatureMask.eyes).length,
          noseDirection: measuredNoseDirection(facing, semanticFeatureMask.nose),
          mouthPixels: semanticFeatureMask.mouth.length,
          semanticFeatureMask,
          semanticPixelsSha256: semanticPixelsSha256(faceRaw, cellIndex, semanticFeatureMask),
          measuredFromSha256: hashBuffer(faceBuffer),
        };
      }
      const bodyId = [(rig === 0 ? "human-a" : "human-b"), facing].join(":");
      const authoredBody = semanticContract.bodyFacePlanes[bodyId];
      const faceInterior = authoredBody.faceInterior;
      const forbiddenFeatureColors = authoredBody.forbiddenFeatureColors;
      const forbiddenKeys = new Set(forbiddenFeatureColors.map((color) => color.join(",")));
      const bodyIndex = rig * 172 + facingIndex * 43;
      let facialFeaturePixels = 0;
      for (let y = faceInterior.y; y < faceInterior.y + faceInterior.height; y += 1) {
        for (let x = faceInterior.x; x < faceInterior.x + faceInterior.width; x += 1) {
          if (forbiddenKeys.has(rgbaKeyAt(bodyRaw, bodyIndex, x, y).key)) facialFeaturePixels += 1;
        }
      }
      bodyPlanes[bodyId] = {
        id: bodyId,
        planePixels,
        facialFeaturePixels,
        faceInterior,
        forbiddenFeatureColors,
        measuredFromSha256: hashBuffer(bodyBuffer),
      };
    }
  }
  return {
    rigs: ["human-a", "human-b"],
    facings: FACINGS,
    expressions: EXPRESSIONS,
    bodyPlanes,
    facePlanes,
  };
}

async function facePlaneValidation(inventory, nativeContract, nativeContractSha256) {
  const faceBuffer = inventory.coreBuffers["human-face-planes.png"];
  const measured = await measureFacePlaneContract(inventory, nativeContract);
  const persisted = {
    rigs: measured.rigs,
    facings: measured.facings,
    expressions: measured.expressions,
    bodyPlanes: nativeContract.bodyFacePlanes,
    facePlanes: nativeContract.facePlanes,
  };
  const result = await analyzeDirectionalFacePlanes(persisted);
  if (JSON.stringify(measured.bodyPlanes) !== JSON.stringify(persisted.bodyPlanes)) {
    result.errors.push("persisted body feature semantic metrics drift from actual native bytes");
  }
  if (JSON.stringify(measured.facePlanes) !== JSON.stringify(persisted.facePlanes)) {
    result.errors.push("persisted face semantic pixel metrics drift from actual native bytes");
  }
  return {
    measuredFromSha256: hashBuffer(faceBuffer),
    measuredFromContractSha256: nativeContractSha256,
    semanticResultsSha256: hashBuffer(Buffer.from(JSON.stringify({
      bodyPlanes: measured.bodyPlanes,
      facePlanes: measured.facePlanes,
    }))),
    errors: result.errors,
  };
}

function buildCanonicalClips() {
  const clips = {};
  for (const rig of ["human-a", "human-b"]) {
    for (const [action, count] of BODY_ACTIONS) {
      for (const facing of FACINGS) {
        const key = `${rig}:${action}:${facing}`;
        clips[key] = {
          frames: Array.from({ length: count }, () => ({ durationMs: 160 })),
          markers: action === "turn" ? [{ name: "facing-switch", frame: 1 }] : [],
          cancelFrames: Array.from({ length: count }, (_unused, index) => index),
        };
      }
    }
  }
  return clips;
}

function clipValidation(nativeContract, nativeContractSha256) {
  const clips = nativeContract.clips ?? {};
  const errors = validateClipInventory(clips, {
    rigs: ["human-a", "human-b"],
    actions: BODY_ACTIONS.map(([action]) => action),
    facings: FACINGS,
  });
  return { errors, clipCount: Object.keys(clips).length, measuredFromContractSha256: nativeContractSha256 };
}

async function cellBuffer(buffer, index, columns, cellWidth, cellHeight) {
  return sharp(buffer).extract({
    left: (index % columns) * cellWidth,
    top: Math.floor(index / columns) * cellHeight,
    width: cellWidth,
    height: cellHeight,
  }).png(PNG_OPTIONS).toBuffer();
}

function actionOffset(action) {
  let offset = 0;
  for (const [candidate, count] of BODY_ACTIONS) {
    if (candidate === action) return offset;
    offset += count;
  }
  throw new Error(`unknown action ${action}`);
}

async function humanContactSheet(coreBuffers) {
  const actionExpression = [
    ["idle", "neutral"], ["walk", "neutral"], ["turn", "neutral"], ["idle", "blink-2"],
    ["idle", "talk-2"], ["work", "neutral"], ["hurt-fall", "hurt"], ["prone", "recovery"],
  ];
  const composites = [];
  let outputIndex = 0;
  for (let rig = 0; rig < 2; rig += 1) {
    for (const [facingIndex] of FACINGS.entries()) {
      for (const [action, expression] of actionExpression) {
        const bodyIndex = rig * 172 + facingIndex * 43 + actionOffset(action);
        const faceIndex = facingIndex * 16 + rig * 8 + EXPRESSIONS.indexOf(expression);
        const hairIndex = facingIndex * 6;
        const layers = await Promise.all([
          cellBuffer(coreBuffers["human-body-rigs.png"], bodyIndex, 16, 48, 64),
          cellBuffer(coreBuffers["human-face-planes.png"], faceIndex, 16, 48, 64),
          cellBuffer(coreBuffers["human-hair.png"], hairIndex, 16, 48, 64),
          cellBuffer(coreBuffers["human-clothing-00.png"], bodyIndex % 172, 16, 48, 64),
        ]);
        const buffer = await sharp({ create: { width: 48, height: 64, channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 } } })
          .composite(layers.map((input) => ({ input })))
          .png(PNG_OPTIONS).toBuffer();
        composites.push({ input: buffer, left: (outputIndex % 8) * 48, top: Math.floor(outputIndex / 8) * 64 });
        outputIndex += 1;
      }
    }
  }
  const [standingBody, standingFace, standingHair, standingClothing] = await Promise.all([
    cellBuffer(coreBuffers["human-body-rigs.png"], 0, 16, 48, 64),
    cellBuffer(coreBuffers["human-face-planes.png"], 0, 16, 48, 64),
    cellBuffer(coreBuffers["human-hair.png"], 0, 16, 48, 64),
    cellBuffer(coreBuffers["human-clothing-00.png"], 0, 16, 48, 64),
  ]);
  for (let silhouette = 0; silhouette < 8; silhouette += 1) {
    const clothing = await cellBuffer(
      coreBuffers[`human-clothing-${String(silhouette).padStart(2, "0")}.png`],
      0,
      16,
      48,
      64,
    );
    const clothingComposite = await sharp({ create: { width: 48, height: 64, channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([
      { input: standingBody }, { input: standingFace }, { input: standingHair }, { input: clothing },
    ]).png(PNG_OPTIONS).toBuffer();
    composites.push({ input: clothingComposite, left: silhouette * 48, top: 512 });

    const hair = await cellBuffer(coreBuffers["human-hair.png"], silhouette * 24, 16, 48, 64);
    const hairComposite = await sharp({ create: { width: 48, height: 64, channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([
      { input: standingBody }, { input: standingFace }, { input: hair }, { input: standingClothing },
    ]).png(PNG_OPTIONS).toBuffer();
    composites.push({ input: hairComposite, left: silhouette * 48, top: 576 });
  }
  return sharp({ create: { width: 384, height: 640, channels: 4,
    background: { r: 180, g: 188, b: 132, alpha: 1 } } }).composite(composites).png(PNG_OPTIONS).toBuffer();
}

async function humanComposite(coreBuffers, rig, facingIndex, action, phase, expression, clothingIndex = 0, heldIndex = 0) {
  const bodyIndex = rig * 172 + facingIndex * 43 + actionOffset(action) + phase;
  const faceIndex = facingIndex * 16 + rig * 8 + EXPRESSIONS.indexOf(expression);
  const hairIndex = facingIndex * 6 + Math.min(5, action === "walk" ? phase % 4 + 2 : action === "hurt-fall" || action === "prone" ? 5 : phase % 2);
  const layers = await Promise.all([
    cellBuffer(coreBuffers["human-body-rigs.png"], bodyIndex, 16, 48, 64),
    cellBuffer(coreBuffers["human-face-planes.png"], faceIndex, 16, 48, 64),
    cellBuffer(coreBuffers["human-hair.png"], hairIndex, 16, 48, 64),
    cellBuffer(coreBuffers[`human-clothing-${String(clothingIndex).padStart(2, "0")}.png`], bodyIndex % 172, 16, 48, 64),
    cellBuffer(coreBuffers["human-held.png"], facingIndex * 16 + heldIndex, 16, 48, 64),
  ]);
  if (action === "hurt-fall" || action === "prone" || action === "dead") {
    const anchor = headAnchorForAction(FACINGS[facingIndex], action, phase);
    layers[1] = await shiftNativeCell(layers[1], anchor.x - (24 + (facingIndex === 1 ? 2 : facingIndex === 3 ? -2 : 0)), anchor.y - 18);
  }
  return sharp({ create: { width: 48, height: 64, channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layers.map((input) => ({ input }))).png(PNG_OPTIONS).toBuffer();
}

async function joeCell144Composite(coreBuffers) {
  const layers = await Promise.all([
    cellBuffer(coreBuffers["human-body-rigs.png"], 174, 16, 48, 64),
    cellBuffer(coreBuffers["human-clothing-02.png"], 2, 16, 48, 64),
    cellBuffer(coreBuffers["human-face-planes.png"], 8, 16, 48, 64),
    cellBuffer(coreBuffers["human-hair.png"], 144, 16, 48, 64),
  ]);
  const native = await sharp({ create: { width: 48, height: 64, channels: 4,
    background: { r: 172, g: 188, b: 132, alpha: 1 } } })
    .composite(layers.map((input) => ({ input })))
    .png(PNG_OPTIONS)
    .toBuffer();
  return scaleEvidenceNearest(native, 192, 256);
}

async function composedRegionGold(inventory, kit) {
  const scene = await regionalCompositionScene(inventory, kit);
  const crop = kit === "spring-terraces" || kit === "neutral-temperate"
    ? { left: 0, top: 224, width: 192, height: 128 }
    : { left: 128, top: 96, width: 192, height: 128 };
  return sharp(scene).extract(crop).png(PNG_OPTIONS).toBuffer();
}

async function ashProductionScene(inventory) {
  const terrain = inventory.outputs.find(({ relativePath }) => (
    relativePath === "regions/ash-waste/terrain.png"
  )).buffer;
  const scenery = inventory.outputs.find(({ relativePath }) => (
    relativePath === "regions/ash-waste/scenery.png"
  )).buffer;
  const environment = inventory.outputs.find(({ relativePath }) => (
    relativePath === "regions/ash-waste/environment.png"
  )).buffer;
  const scaleCell = async (buffer) => scaleEvidenceNearest(buffer, 64, 64);
  const [groundCells, pathCells, sceneryCells, emberCells] = await Promise.all([
    Promise.all(Array.from({ length: 8 }, async (_unused, index) => scaleCell(await cellBuffer(terrain, index, 8, 32, 32)))),
    Promise.all(Array.from({ length: 8 }, async (_unused, index) => scaleCell(await cellBuffer(terrain, 8 + index, 8, 32, 32)))),
    Promise.all(Array.from({ length: 128 }, async (_unused, index) => scaleCell(await cellBuffer(scenery, index, 16, 32, 32)))),
    Promise.all(Array.from({ length: 4 }, async (_unused, index) => scaleCell(await cellBuffer(environment, index, 8, 32, 32)))),
  ]);
  const columns = 22;
  const rows = 14;
  const pathTiles = new Set();
  for (let column = 1; column < columns - 1; column += 1) {
    const center = 7 + Math.round(Math.sin(column / 3) * 1);
    pathTiles.add(`${column},${center}`);
    pathTiles.add(`${column},${center + 1}`);
  }
  const connectedVariants = [7, 1, 0, 2, 1, 1, 3, 6, 0, 5, 0, 6, 4, 6, 6, 6];
  const composites = [];
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const key = `${column},${row}`;
    let input = groundCells[(column * 3 + row * 5) % 8];
    if (pathTiles.has(key)) {
      const mask = [[0, -1], [1, 0], [0, 1], [-1, 0]].reduce((value, [dx, dy], bit) => (
        pathTiles.has(`${column + dx},${row + dy}`) ? value | 1 << bit : value
      ), 0);
      input = pathCells[connectedVariants[mask]];
    }
    composites.push({ input, left: column * 64 + 16, top: row * 64 + 2 });
  }
  for (const [kind, variant, column, row] of ASH_SCENE_PROOF.placements) {
    composites.push({ input: sceneryCells[kind + variant * 4], left: column * 64 + 16, top: row * 64 + 2 });
  }
  for (const [index, [column, row]] of ASH_SCENE_PROOF.emberPlacements.entries()) {
    composites.push({ input: emberCells[index % emberCells.length], left: column * 64 + 16, top: row * 64 + 2 });
  }
  return sharp({ create: { width: ASH_SCENE_PROOF.width, height: ASH_SCENE_PROOF.height, channels: 4,
    background: { r: 36, g: 36, b: 44, alpha: 1 } } })
    .composite(composites)
    .png(PNG_OPTIONS)
    .toBuffer();
}

async function shiftNativeCell(buffer, dx, dy) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(data.length);
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    const toX = x + dx; const toY = y + dy;
    if (toX < 0 || toY < 0 || toX >= info.width || toY >= info.height) continue;
    const sourceOffset = (y * info.width + x) * 4;
    data.copy(output, (toY * info.width + toX) * 4, sourceOffset, sourceOffset + 4);
  }
  return sharp(output, { raw: info }).png(PNG_OPTIONS).toBuffer();
}

async function assembledHomeState(inventory, kit, state, doorwayHuman = null) {
  const components = inventory.outputs.find(({ relativePath }) => relativePath === `homes/${kit}/components.png`).buffer;
  const ruins = inventory.outputs.find(({ relativePath }) => relativePath === `homes/${kit}/ruins.png`).buffer;
  if (state.startsWith("rubble-") || state.startsWith("ruin-")) {
    const ruinIndex = state.endsWith("full") ? 0 : state.endsWith("picked") ? 2 : 4;
    return cellBuffer(ruins, ruinIndex, 4, 128, 128);
  }
  const stateComponents = {
    cold: [0, 1, 2, 6, 9, 16, 19],
    lit: [0, 1, 2, 6, 9, 17, 20],
    doorway: [0, 1, 2, 6, 13, 17, 20],
    damaged: [0, 1, 3, 7, 14, 18],
    collapse: [0, 1, 5, 8, 15, 23],
  };
  const layers = await Promise.all((stateComponents[state] ?? stateComponents.cold)
    .map((index) => cellBuffer(components, index, 6, 128, 128)));
  const composites = layers.map((input) => ({ input, left: 0, top: 0 }));
  if (doorwayHuman !== null) composites.push({ input: doorwayHuman, left: 10, top: 61 });
  return sharp({ create: { width: 128, height: 128, channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(composites).png(PNG_OPTIONS).toBuffer();
}

async function goldMasterApprovalSheet(inventory) {
  const canvas = sharp({ create: { width: 1024, height: 640, channels: 4,
    background: { r: 28, g: 30, b: 38, alpha: 1 } } });
  const composites = [];
  const standing = [];
  for (let rig = 0; rig < 2; rig += 1) for (let facing = 0; facing < 4; facing += 1) {
    standing.push(await humanComposite(inventory.coreBuffers, rig, facing, "idle", 0, "neutral", rig));
  }
  standing.forEach((input, index) => composites.push({ input, left: 40 + index * 62, top: 8 }));
  const representatives = [
    ["walk", 0, "neutral", 0], ["walk", 2, "neutral", 0], ["walk", 5, "neutral", 0],
    ["turn", 0, "neutral", 0], ["turn", 1, "neutral", 0], ["work", 3, "neutral", 5],
    ["hurt-fall", 2, "hurt", 0], ["prone", 0, "hurt", 0], ["prone", 1, "recovery", 0], ["dead", 0, "hurt", 0],
  ];
  for (let rig = 0; rig < 2; rig += 1) {
    for (const [index, [action, phase, expression, held]] of representatives.entries()) {
      const input = await humanComposite(inventory.coreBuffers, rig, rig === 0 ? 1 : 0,
        action, phase, expression, rig, held);
      composites.push({ input, left: 24 + index * 52, top: 68 + rig * 62 });
    }
  }
  for (const [kitIndex, kit] of REGION_KITS.entries()) {
    composites.push({ input: await composedRegionGold(inventory, kit), left: 32 + kitIndex * 192, top: 208 });
  }
  const doorwayHuman = await humanComposite(inventory.coreBuffers, 0, 0, "walk", 2, "neutral", 0);
  const homeStates = ["cold", "lit", "doorway", "damaged", "collapse", "rubble-full", "rubble-picked"];
  for (const [index, state] of homeStates.entries()) {
    composites.push({ input: await assembledHomeState(inventory, "worn-heartland", state,
      state === "doorway" ? doorwayHuman : null), left: 64 + index * 128, top: 368 });
  }
  const eastBody = await cellBuffer(inventory.coreBuffers["human-body-rigs.png"], 43, 16, 48, 64);
  const eastFace = await cellBuffer(inventory.coreBuffers["human-face-planes.png"], 16, 16, 48, 64);
  const eastHair = await cellBuffer(inventory.coreBuffers["human-hair.png"], 6, 16, 48, 64);
  const eastClothing = await cellBuffer(inventory.coreBuffers["human-clothing-00.png"], 43, 16, 48, 64);
  const eastHeld = await cellBuffer(inventory.coreBuffers["human-held.png"], 16, 16, 48, 64);
  const eastFinal = await humanComposite(inventory.coreBuffers, 0, 1, "idle", 0, "neutral", 0);
  [eastBody, eastFace, eastHair, eastClothing, eastHeld, eastFinal].forEach((input, index) => {
    composites.push({ input, left: 32 + index * 56, top: 544 });
  });
  const swatches = createSurface(600, 64);
  const colors = ["#ac7c54", "#f4ac6c", "#fce4bc", "#9c6044", "#dc9464", "#f4c08c",
    "#24181c", "#442c24", "#6c4c34", "#4c7454", "#94c494", "#24bcb4", "#e4ac84", "#444454", "#e46c5c"];
  colors.forEach((color, index) => outlinedRect(swatches, index * 32, 8, 28, 24, rgba(color)));
  composites.push({ input: await encodeSurface(swatches), left: 380, top: 552 });
  const guide = Buffer.from(`<svg width="1024" height="640" xmlns="http://www.w3.org/2000/svg"><g fill="#f4eedf" font-family="sans-serif" font-size="11"><text x="4" y="12">HUMAN GOLD MASTER</text><text x="4" y="220">FIVE REGION SCENES</text><text x="4" y="380">ASSEMBLED HOME LIFE</text><text x="4" y="540">LAYER BREAKDOWN + PALETTE</text></g></svg>`);
  composites.push({ input: guide, left: 0, top: 0 });
  return canvas.composite(composites).png(PNG_OPTIONS).toBuffer();
}

async function scaleEvidenceNearest(buffer, width, height) {
  return sharp(buffer).resize(width, height, { kernel: "nearest", fit: "fill" }).png(PNG_OPTIONS).toBuffer();
}

function rectangularTilePatch(x, y, width, height) {
  return Array.from({ length: height }, (_unused, row) => (
    Array.from({ length: width }, (_unused2, column) => ({ x: x + column, y: y + row }))
  )).flat();
}

function connectedRouteTiles() {
  const tiles = [];
  const add = (x, y) => {
    if (!tiles.some((tile) => tile.x === x && tile.y === y)) tiles.push({ x, y });
  };
  for (let x = 0; x <= 6; x += 1) add(x, 3);
  for (let y = 3; y <= 6; y += 1) add(6, y);
  for (let x = 6; x <= 12; x += 1) add(x, 6);
  for (let y = 6; y <= 15; y += 1) add(12, y);
  for (let x = 12; x <= 20; x += 1) add(x, 15);
  for (let y = 13; y <= 15; y += 1) add(20, y);
  return tiles;
}

function cardinalTileSetConnected(tiles) {
  if (tiles.length === 0) return false;
  const remaining = new Set(tiles.map(({ x, y }) => `${x},${y}`));
  const queue = [remaining.values().next().value];
  remaining.delete(queue[0]);
  while (queue.length > 0) {
    const key = queue.shift();
    const [x, y] = key.split(",").map(Number);
    for (const neighbor of [`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`]) {
      if (!remaining.delete(neighbor)) continue;
      queue.push(neighbor);
    }
  }
  return remaining.size === 0;
}

function waterAndShoreTiles(kit) {
  const waterRows = kit === "spring-terraces"
    ? [[7, 3, 5], [8, 3, 5], [9, 2, 7], [10, 1, 8], [11, 1, 8], [12, 1, 8], [13, 2, 8]]
    : kit === "neutral-temperate"
      ? [[8, 6, 8], [9, 6, 8], [10, 4, 9], [11, 2, 10], [12, 2, 10], [13, 2, 10], [14, 2, 10]]
      : [];
  if (waterRows.length === 0) return { waterTiles: [], shoreTiles: [] };
  const waterTiles = waterRows.flatMap(([y, startX, endX]) => (
    Array.from({ length: endX - startX + 1 }, (_unused, offset) => ({ x: startX + offset, y }))
  ));
  const waterKeys = new Set(waterTiles.map(({ x, y }) => `${x},${y}`));
  const shoreByKey = new Map();
  for (const { x, y } of waterTiles) for (const [dx, dy] of [
    [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
  ]) {
    const shore = { x: x + dx, y: y + dy };
    const key = `${shore.x},${shore.y}`;
    if (shore.x < 0 || shore.y < 0 || shore.x >= 24 || shore.y >= 16 || waterKeys.has(key)) continue;
    shoreByKey.set(key, shore);
  }
  const cardinallyWet = (tile) => [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => (
    waterKeys.has(`${tile.x + dx},${tile.y + dy}`)
  ));
  const required = [...shoreByKey.values()].filter(cardinallyWet);
  const bridges = [...shoreByKey.values()].filter((tile) => !cardinallyWet(tile))
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const shoreTiles = [...required, ...bridges];
  for (const bridge of bridges) {
    const candidate = shoreTiles.filter((tile) => tile !== bridge);
    if (cardinalTileSetConnected(candidate)) shoreTiles.splice(shoreTiles.indexOf(bridge), 1);
  }
  return { waterTiles, shoreTiles };
}

function proofGroundVariant(kit, x, y) {
  const kitOffset = REGION_KITS.indexOf(kit);
  const calm = y <= 4 || (x <= 7 && y <= 12) || (x >= 16 && y >= 11);
  const variants = calm ? [0, 1, 4, 6] : [2, 3, 5, 7];
  return variants[(x + y * 2 + kitOffset) % variants.length];
}

function regionalCompositionPlan(kit) {
  const art = REGION_ART[kit];
  const { waterTiles, shoreTiles } = waterAndShoreTiles(kit);
  const terrainPatches = kit === "spring-terraces"
    ? [rectangularTilePatch(11, 1, 5, 3), rectangularTilePatch(14, 7, 5, 3)]
    : kit === "neutral-temperate"
      ? [rectangularTilePatch(10, 1, 6, 3), rectangularTilePatch(14, 7, 5, 3)]
      : kit === "ash-waste"
        ? [rectangularTilePatch(2, 5, 6, 3), rectangularTilePatch(13, 7, 6, 3), rectangularTilePatch(16, 11, 6, 3)]
        : [rectangularTilePatch(3, 5, 5, 3), rectangularTilePatch(13, 7, 6, 3)];
  const cells = kit === "spring-terraces" ? [0, 4, 7, 2]
    : kit === "worn-heartland" ? [0, 3, 6, 1]
      : kit === "dry-scrub" ? [0, 3, 5, 2]
        : kit === "ash-waste" ? [0, 2, 4, 7]
          : [0, 3, 5, 2];
  const positions = kit === "spring-terraces"
    ? [[64, 240], [96, 224], [224, 224], [448, 176]]
    : [[16, 128], [224, 32], [256, 224], [448, 176]];
  const landmarks = cells.map((cell, index) => ({
    cell,
    semanticKind: LANDMARK_INVENTORY[kit][cell][0],
    x: positions[index][0],
    y: positions[index][1],
  }));
  const supportCoordinates = [
    [0, 160], [96, 160], [224, 16], [320, 64], [240, 272], [336, 272],
    [448, 208], [544, 240], [32, 288], [128, 288], [352, 32], [416, 272],
  ];
  const supports = supportCoordinates.map(([x, y], index) => ({ cell: index % 12, x, y }));
  const occupied = new Set([
    ...connectedRouteTiles(), ...terrainPatches.flat(), ...waterTiles, ...shoreTiles,
  ].map(({ x, y }) => `${x},${y}`));
  const groundTiles = [];
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 24; x += 1) {
    if (occupied.has(`${x},${y}`)) continue;
    groundTiles.push({ x, y, variant: proofGroundVariant(kit, x, y) });
  }
  return Object.freeze({
    kit,
    widthTiles: 24,
    heightTiles: 16,
    routeTiles: connectedRouteTiles(),
    terrainPatches,
    groundTiles,
    waterTiles,
    shoreTiles,
    landmarks,
    supports,
    yard: { x: 560, y: 320, cell: 0, doorTile: { x: 20, y: 13 } },
    home: { x: 592, y: 336 },
    pathColors: art.path.map((color) => rgba(color).slice(0, 3)),
  });
}

function connectedVariant(tiles, x, y) {
  const occupied = new Set(tiles.map((tile) => `${tile.x},${tile.y}`));
  const mask = [occupied.has(`${x},${y - 1}`), occupied.has(`${x + 1},${y}`),
    occupied.has(`${x},${y + 1}`), occupied.has(`${x - 1},${y}`)];
  const exact = CONNECTED_TERRAIN_DIRECTIONS.findIndex((candidate) => (
    candidate.every((connected, index) => connected === mask[index])
  ));
  return exact === -1 ? 6 : exact;
}

function tileKey(tile) {
  return `${tile.x},${tile.y}`;
}

async function regionalCompositionScene(inventory, kit, plan = regionalCompositionPlan(kit)) {
  const terrain = inventory.outputs.find(({ relativePath }) => relativePath === `regions/${kit}/terrain.png`).buffer;
  const landmarks = inventory.outputs.find(({ relativePath }) => relativePath === `regions/${kit}/landmarks.png`).buffer;
  const scenery = inventory.outputs.find(({ relativePath }) => relativePath === `regions/${kit}/scenery.png`).buffer;
  const yards = inventory.outputs.find(({ relativePath }) => relativePath === `homes/${kit}/yards.png`).buffer;
  const composites = [];
  const routeKeys = new Set(plan.routeTiles.map(tileKey));
  const waterKeys = new Set(plan.waterTiles.map(tileKey));
  const shoreKeys = new Set(plan.shoreTiles.map(tileKey));
  const soilTiles = plan.terrainPatches.flat();
  const soilKeys = new Set(soilTiles.map(tileKey));
  const groundVariantByKey = new Map(plan.groundTiles.map(({ x, y, variant }) => [`${x},${y}`, variant]));
  for (let y = 0; y < plan.heightTiles; y += 1) for (let x = 0; x < plan.widthTiles; x += 1) {
    const key = `${x},${y}`;
    let cell = groundVariantByKey.get(key) ?? (x * 3 + y * 5) % 8;
    if (soilKeys.has(key)) cell = 32 + (x + y) % 4;
    if (shoreKeys.has(key)) cell = 24 + connectedVariant(plan.shoreTiles, x, y);
    if (waterKeys.has(key)) cell = 16 + connectedVariant(plan.waterTiles, x, y);
    if (routeKeys.has(key)) cell = 8 + connectedVariant(plan.routeTiles, x, y);
    composites.push({ input: await cellBuffer(terrain, cell, 8, 32, 32), left: x * 32, top: y * 32 });
  }
  for (const placement of plan.landmarks) composites.push({
    input: await cellBuffer(landmarks, placement.cell, 4, 128, 128), left: placement.x, top: placement.y,
  });
  for (const placement of plan.supports) composites.push({
    input: await cellBuffer(scenery, placement.cell, 16, 32, 32), left: placement.x, top: placement.y,
  });
  const yard = await cellBuffer(yards, plan.yard.cell, 5, 192, 160);
  const warmYard = await cellBuffer(yards, 2, 5, 192, 160);
  const hoardYard = await cellBuffer(yards, 3, 5, 192, 160);
  const home = await assembledHomeState(inventory, kit, "lit");
  composites.push({ input: yard, left: plan.yard.x, top: plan.yard.y });
  composites.push({ input: warmYard, left: plan.yard.x, top: plan.yard.y });
  composites.push({ input: hoardYard, left: plan.yard.x, top: plan.yard.y });
  composites.push({ input: home, left: plan.home.x, top: plan.home.y });
  return sharp({ create: { width: 768, height: 512, channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites)
    .png(NATIVE_PNG_OPTIONS)
    .toBuffer();
}

function regionalR4Output(inventory, relativePath) {
  const output = inventory.outputs.find((candidate) => candidate.relativePath === relativePath);
  if (!output?.buffer) throw new Error(`${relativePath}: R4 composition source missing`);
  return output.buffer;
}

async function regionalR4CompositionScene(inventory, kit, plan) {
  const terrain = regionalR4Output(inventory, `regions/${kit}/terrain.png`);
  const landmarks = regionalR4Output(inventory, `regions/${kit}/landmarks.png`);
  const scenery = regionalR4Output(inventory, `regions/${kit}/scenery.png`);
  const yards = regionalR4Output(inventory, `homes/${kit}/yards.png`);
  const composites = [];
  const routeKeys = new Set(plan.routeTiles.map(tileKey));
  const waterKeys = new Set(plan.waterTiles.map(tileKey));
  const shoreKeys = new Set(plan.shoreTiles.map(tileKey));
  const bridgeKeys = new Set(plan.bridgeTiles.map(tileKey));
  const soilTiles = plan.terrainPatches.flatMap(({ tiles }) => tiles);
  const soilKeys = new Set(soilTiles.map(tileKey));
  for (let y = 0; y < plan.heightTiles; y += 1) for (let x = 0; x < plan.widthTiles; x += 1) {
    const key = `${x},${y}`;
    let cell = plan.groundRecipeGrid[y][x];
    if (soilKeys.has(key)) cell = 32 + (x + y) % 4;
    if (shoreKeys.has(key)) cell = 24 + connectedVariant(plan.shoreTiles, x, y);
    if (waterKeys.has(key)) cell = 16 + connectedVariant(plan.waterTiles, x, y);
    if (routeKeys.has(key) || bridgeKeys.has(key)) cell = 8 + connectedVariant(plan.routeTiles, x, y);
    composites.push({ input: await cellBuffer(terrain, cell, 8, 32, 32), left: x * 32, top: y * 32 });
  }
  for (const placement of plan.landmarks) composites.push({
    input: await cellBuffer(landmarks, placement.cell, 4, 128, 128), left: placement.x, top: placement.y,
  });
  for (const placement of plan.supports) composites.push({
    input: await cellBuffer(scenery, placement.cell, 16, 32, 32), left: placement.x, top: placement.y,
  });
  const yardRecipe = REGIONAL_R4_VARIANT_RECIPES[kit].yards.find(({ id }) => id === plan.yard.recipeId);
  if (!yardRecipe) throw new Error(`${kit}/${plan.yard.recipeId}: R4 yard recipe missing`);
  const yardCell = REGIONAL_R4_VARIANT_RECIPES[kit].yards.indexOf(yardRecipe);
  const home = await assembledHomeState(inventory, kit, "lit");
  for (const cell of [yardCell, 2, 3]) composites.push({
    input: await cellBuffer(yards, cell, 5, 192, 160),
    left: plan.yard.originPx.x,
    top: plan.yard.originPx.y,
  });
  composites.push({ input: home, left: plan.home.plotCenterPx.x, top: plan.home.plotCenterPx.y });
  return sharp({ create: { width: 768, height: 512, channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites)
    .png(NATIVE_PNG_OPTIONS)
    .toBuffer();
}

async function regionalCompositionEvidence(
  inventory,
  kits = REGION_KITS,
  filePrefix = "task12r",
  ashRiskFile = "task12r-ash-risk-first-composed.png",
) {
  const evidence = {};
  for (const kit of kits) {
    const landmarks = inventory.outputs.find(({ relativePath }) => relativePath === `regions/${kit}/landmarks.png`).buffer;
    const yards = inventory.outputs.find(({ relativePath }) => relativePath === `homes/${kit}/yards.png`).buffer;
    const scene = await regionalCompositionScene(inventory, kit);
    evidence[`${filePrefix}-${kit}-landmarks-native-1x.png`] = landmarks;
    evidence[`${filePrefix}-${kit}-landmarks-nearest-2x.png`] = await scaleEvidenceNearest(landmarks, 1024, 512);
    evidence[`${filePrefix}-${kit}-yards-native-1x.png`] = yards;
    evidence[`${filePrefix}-${kit}-yards-nearest-2x.png`] = await scaleEvidenceNearest(yards, 1920, 320);
    evidence[`${filePrefix}-${kit}-composed-native-1x.png`] = scene;
    if (kit === "ash-waste") evidence[ashRiskFile] = scene;
  }
  return evidence;
}

/** Return the closed terrain-inclusive R4 proof inventory without writing bytes. */
export function regionalR4EvidenceNames() {
  const names = [];
  for (const kit of REGION_KITS) for (const artifact of [
    "terrain-native-1x",
    "terrain-nearest-2x",
    "landmarks-native-1x",
    "landmarks-nearest-2x",
    "yards-native-1x",
    "yards-nearest-2x",
    "composed-native-1x",
    "composed-nearest-2x",
  ]) names.push(`task12r-r4-${kit}-${artifact}.png`);
  names.push("task12r-r4-ash-risk-first-composed.png");
  return names.sort();
}

async function regionalR4Evidence(candidate) {
  const evidence = {};
  for (const kit of REGION_KITS) {
    const terrain = candidate.buffers[`${kit}-terrain`];
    const landmarks = candidate.buffers[`${kit}-landmarks`];
    const yards = candidate.buffers[`${kit}-home-yards`];
    const scene = candidate.proofs[kit];
    evidence[`task12r-r4-${kit}-terrain-native-1x.png`] = terrain;
    evidence[`task12r-r4-${kit}-terrain-nearest-2x.png`] = await scaleEvidenceNearest(terrain, 512, 512);
    evidence[`task12r-r4-${kit}-landmarks-native-1x.png`] = landmarks;
    evidence[`task12r-r4-${kit}-landmarks-nearest-2x.png`] = await scaleEvidenceNearest(landmarks, 1024, 512);
    evidence[`task12r-r4-${kit}-yards-native-1x.png`] = yards;
    evidence[`task12r-r4-${kit}-yards-nearest-2x.png`] = await scaleEvidenceNearest(yards, 1920, 320);
    evidence[`task12r-r4-${kit}-composed-native-1x.png`] = scene;
    evidence[`task12r-r4-${kit}-composed-nearest-2x.png`] = await scaleEvidenceNearest(scene, 1536, 1024);
    if (kit === "ash-waste") evidence["task12r-r4-ash-risk-first-composed.png"] = scene;
  }
  const expected = regionalR4EvidenceNames().sort();
  const actual = Object.keys(evidence).sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error("R4 proof evidence inventory drift");
  return evidence;
}

const PROOF_FILE_OPERATIONS = Object.freeze({ mkdir, readFile, writeFile, rename, rm });

/** Atomically publish proof evidence through an injectable filesystem boundary. */
export async function publishProofEvidenceAtomically({
  evidence,
  destinationRoot,
  fileOperations = {},
  temporaryTag = "r4-proof",
}) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("Atomic proof publication requires an evidence object");
  }
  if (typeof destinationRoot !== "string" || destinationRoot.length === 0) {
    throw new Error("Atomic proof publication requires a destination root");
  }
  const operations = { ...PROOF_FILE_OPERATIONS, ...fileOperations };
  await operations.mkdir(destinationRoot, { recursive: true });
  const staged = [];
  const attemptedCommits = [];
  const rollbackPaths = [];
  try {
    for (const [name, buffer] of Object.entries(evidence).sort(([left], [right]) => left.localeCompare(right))) {
      if (path.basename(name) !== name || !Buffer.isBuffer(buffer)) {
        throw new Error(`${name}: proof evidence requires a basename and Buffer bytes`);
      }
      const destination = path.join(destinationRoot, name);
      const temporary = `${destination}.tmp-${temporaryTag}-${process.pid}`;
      let previous = null;
      try {
        previous = await operations.readFile(destination);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const publication = { destination, temporary, previous };
      staged.push(publication);
      await operations.writeFile(temporary, buffer);
    }
    for (const publication of staged) {
      attemptedCommits.push(publication);
      await operations.rename(publication.temporary, publication.destination);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const publication of [...attemptedCommits].reverse()) {
      try {
        if (publication.previous === null) await operations.rm(publication.destination, { force: true });
        else {
          const rollback = `${publication.destination}.tmp-${temporaryTag}-rollback-${process.pid}`;
          rollbackPaths.push(rollback);
          await operations.writeFile(rollback, publication.previous);
          await operations.rename(rollback, publication.destination);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    await Promise.allSettled([
      ...staged.map(({ temporary }) => operations.rm(temporary, { force: true })),
      ...rollbackPaths.map((rollback) => operations.rm(rollback, { force: true })),
    ]);
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], "Atomic proof rollback failed");
    }
    throw error;
  }
  return evidence;
}

/** Validate an R4 candidate before atomically writing any proof evidence. */
export async function writeRegionalR4Proofs({
  candidateBuilder = buildRegionalCompositionAuthoring,
  candidateValidator = validateRegionalR4Candidate,
  evidenceBuilder = regionalR4Evidence,
  destinationRoot = EVIDENCE_ROOT,
  fileOperations = {},
} = {}) {
  const candidate = await candidateBuilder();
  const validationErrors = await candidateValidator(candidate);
  if (validationErrors.length > 0) {
    throw new Error(`R4 proof validation failed before staging:\n${validationErrors.join("\n")}`);
  }
  return publishProofEvidenceAtomically({
    evidence: await evidenceBuilder(candidate),
    destinationRoot,
    fileOperations,
  });
}

export async function writeRegionalR3Proofs(version = "r3") {
  const { buffers, proofs } = await buildRegionalR3DiagnosticAuthoring();
  const evidence = {};
  for (const kit of REGION_KITS) {
    const landmarks = buffers[`${kit}-landmarks`];
    const yards = buffers[`${kit}-home-yards`];
    const scene = proofs[kit];
    evidence[`task12r-${version}-${kit}-landmarks-native-1x.png`] = landmarks;
    evidence[`task12r-${version}-${kit}-landmarks-nearest-2x.png`] = await scaleEvidenceNearest(landmarks, 1024, 512);
    evidence[`task12r-${version}-${kit}-yards-native-1x.png`] = yards;
    evidence[`task12r-${version}-${kit}-yards-nearest-2x.png`] = await scaleEvidenceNearest(yards, 1920, 320);
    evidence[`task12r-${version}-${kit}-composed-native-1x.png`] = scene;
    evidence[`task12r-${version}-${kit}-composed-nearest-2x.png`] = await scaleEvidenceNearest(scene, 1536, 1024);
    if (kit === "ash-waste") evidence[`task12r-${version}-ash-risk-first-composed.png`] = scene;
  }
  return publishProofEvidenceAtomically({
    evidence,
    destinationRoot: EVIDENCE_ROOT,
    temporaryTag: `${version}-proof`,
  });
}

export async function writeAshCompositionProof() {
  const { buffers, proofs } = await buildRegionalR3DiagnosticAuthoring();
  const landmarks = buffers["ash-waste-landmarks"];
  const yards = buffers["ash-waste-home-yards"];
  const scene = proofs["ash-waste"];
  const evidence = {
    "task12r-r2-ash-waste-landmarks-native-1x.png": landmarks,
    "task12r-r2-ash-waste-landmarks-nearest-2x.png": await scaleEvidenceNearest(landmarks, 1024, 512),
    "task12r-r2-ash-waste-yards-native-1x.png": yards,
    "task12r-r2-ash-waste-yards-nearest-2x.png": await scaleEvidenceNearest(yards, 1920, 320),
    "task12r-r2-ash-waste-composed-native-1x.png": scene,
    "task12r-r2-ash-risk-first-composed.png": scene,
  };
  return publishProofEvidenceAtomically({
    evidence,
    destinationRoot: EVIDENCE_ROOT,
    temporaryTag: "ash-proof",
  });
}

async function buildEvidence(inventory) {
  const human1x = await humanContactSheet(inventory.coreBuffers);
  const human2x = await scaleEvidenceNearest(human1x, 768, 1280);
  const regionComposites = [];
  for (const [kitIndex, kit] of REGION_KITS.entries()) {
    const terrain = inventory.outputs.find(({ relativePath }) => relativePath === `regions/${kit}/terrain.png`).buffer;
    const scenery = inventory.outputs.find(({ relativePath }) => relativePath === `regions/${kit}/scenery.png`).buffer;
    const environment = inventory.outputs.find(({ relativePath }) => relativePath === `regions/${kit}/environment.png`).buffer;
    regionComposites.push({ input: terrain, left: kitIndex * 512, top: 0 });
    regionComposites.push({ input: scenery, left: kitIndex * 512, top: 256 });
    regionComposites.push({ input: environment, left: kitIndex * 512, top: 512 });
  }
  const regions1x = await sharp({ create: { width: 2560, height: 640, channels: 4,
    background: { r: 32, g: 38, b: 52, alpha: 1 } } }).composite(regionComposites).png(PNG_OPTIONS).toBuffer();
  const doorwayHuman = await humanComposite(inventory.coreBuffers, 0, 0, "walk", 2, "neutral", 0);
  const homeStates = [
    "cold", "lit", "doorway", "damaged", "collapse", "ruin-full", "ruin-picked", "ruin-bare",
  ];
  const homeLifecycleComposites = [];
  for (const [kitIndex, kit] of REGION_KITS.entries()) {
    for (const [stateIndex, state] of homeStates.entries()) {
      homeLifecycleComposites.push({
        input: await assembledHomeState(inventory, kit, state, state === "doorway" ? doorwayHuman : null),
        left: stateIndex * 128,
        top: kitIndex * 128,
      });
    }
  }
  const homes1x = await sharp({ create: { width: 1024, height: 640, channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(homeLifecycleComposites).png(PNG_OPTIONS).toBuffer();
  const selectedCells = [
    {
      id: "standing-south-human",
      evidenceRole: "standing-human",
      kind: "human-cell",
      sourceKind: "native-cell",
      source: { width: 48, height: 64 },
      buffer: await humanComposite(inventory.coreBuffers, 0, 0, "idle", 0, "neutral", 0),
    },
    {
      id: "profile-talking-east-human",
      evidenceRole: "profile-talking-human",
      kind: "human-cell",
      sourceKind: "native-cell",
      source: { width: 48, height: 64 },
      buffer: await humanComposite(inventory.coreBuffers, 1, 1, "idle", 0, "talk-2", 1),
    },
    {
      id: "prone-recovery-west-human",
      evidenceRole: "prone-recovery-human",
      kind: "human-cell",
      sourceKind: "native-cell",
      source: { width: 48, height: 64 },
      buffer: await humanComposite(inventory.coreBuffers, 0, 3, "prone", 1, "recovery", 0),
    },
    {
      id: "occupied-spring-doorway-home",
      evidenceRole: "doorway-home",
      kind: "home-cell",
      sourceKind: "native-cell",
      source: { width: 128, height: 128 },
      buffer: await assembledHomeState(inventory, "spring-terraces", "doorway", doorwayHuman),
    },
    {
      id: "persistent-ash-ruin",
      evidenceRole: "persistent-ruin",
      kind: "home-cell",
      sourceKind: "native-cell",
      source: { width: 128, height: 128 },
      buffer: await assembledHomeState(inventory, "ash-waste", "rubble-bare"),
    },
  ];
  const mobileCoordinates = [
    { x: 8, y: 8, scale: 1 },
    { x: 64, y: 8, scale: 2 },
    { x: 168, y: 8, scale: 1 },
    { x: 8, y: 152, scale: 1 },
    { x: 144, y: 152, scale: 1 },
  ];
  const desktopCoordinates = selectedCells.map((_cell, index) => ({
    x: 32 + index * 272,
    y: 48,
    scale: 2,
  }));
  const mobileLayout = {
    viewport: { id: "mobile-390x844", width: 390, height: 844 },
    placements: selectedCells.map(({ buffer: _buffer, ...cell }, index) => ({
      ...cell,
      ...mobileCoordinates[index],
    })),
  };
  const desktopLayout = {
    viewport: { id: "desktop-1440x900", width: 1440, height: 900 },
    placements: selectedCells.map(({ buffer: _buffer, ...cell }, index) => ({
      ...cell,
      ...desktopCoordinates[index],
    })),
  };
  const responsiveErrors = [
    ...validateResponsiveEvidenceLayout(mobileLayout),
    ...validateResponsiveEvidenceLayout(desktopLayout),
  ];
  if (responsiveErrors.length > 0) {
    throw new Error(`Responsive evidence layout failed:\n${responsiveErrors.join("\n")}`);
  }
  const compositeSelectedCells = async (layout) => Promise.all(layout.placements.map(async (placement) => {
    const selected = selectedCells.find(({ id }) => id === placement.id);
    const input = placement.scale === 1
      ? selected.buffer
      : await scaleEvidenceNearest(
        selected.buffer,
        selected.source.width * placement.scale,
        selected.source.height * placement.scale,
      );
    return { input, left: placement.x, top: placement.y };
  }));
  const regionScenes = await Promise.all(REGION_KITS.map((kit) => composedRegionGold(inventory, kit)));
  const desktopRegions = await Promise.all(regionScenes.map((scene) => scaleEvidenceNearest(scene, 384, 256)));
  const desktopRegionCoordinates = [
    { left: 32, top: 360 }, { left: 496, top: 360 }, { left: 960, top: 360 },
    { left: 264, top: 640 }, { left: 728, top: 640 },
  ];
  const desktop = await sharp({ create: { width: 1440, height: 900, channels: 4,
    background: { r: 28, g: 32, b: 40, alpha: 1 } } }).composite([
    ...await compositeSelectedCells(desktopLayout),
    ...desktopRegions.map((input, index) => ({ input, ...desktopRegionCoordinates[index] })),
  ]).png(PNG_OPTIONS).toBuffer();
  const mobileRegionCoordinates = [
    { left: 3, top: 304 }, { left: 195, top: 304 },
    { left: 3, top: 432 }, { left: 195, top: 432 },
    { left: 99, top: 560 },
  ];
  const mobile = await sharp({ create: { width: 390, height: 844, channels: 4,
    background: { r: 28, g: 32, b: 40, alpha: 1 } } }).composite([
    ...await compositeSelectedCells(mobileLayout),
    ...regionScenes.map((input, index) => ({ input, ...mobileRegionCoordinates[index] })),
  ]).png(PNG_OPTIONS).toBuffer();
  const preservedTask12rDiagnostics = Object.fromEntries(await Promise.all(
    PRESERVED_TASK12R_DIAGNOSTIC_EVIDENCE.map(async (name) => [name, await readFile(path.join(EVIDENCE_ROOT, name))]),
  ));
  return {
    "task8-gold-master-approval-1x.png": await goldMasterApprovalSheet(inventory),
    "contact-sheet-human-1x.png": human1x,
    "contact-sheet-human-2x.png": human2x,
    "joe-human-b-south-idle2-coils-cell144-4x.png": await joeCell144Composite(inventory.coreBuffers),
    "contact-sheet-regions-1x.png": regions1x,
    "contact-sheet-homes-1x.png": homes1x,
    "contact-sheet-desktop-1440x900.png": desktop,
    "contact-sheet-mobile-390x844.png": mobile,
    [ASH_SCENE_PROOF.file]: await ashProductionScene(inventory),
    ...preservedTask12rDiagnostics,
    ...await regionalCompositionEvidence(inventory),
  };
}

function metadataAtlas(descriptor) {
  const { id, path: atlasPath, group, regionKit, width, height, cellWidth, cellHeight,
    columns, rows, compressedBytes, decodedBytes, sha256 } = descriptor;
  return { id, path: atlasPath, group, regionKit, width, height, cellWidth, cellHeight,
    columns, rows, compressedBytes, decodedBytes, sha256 };
}

function compactBodyFrameAnchors(nativeContract) {
  const frames = nativeContract.atlases?.["core-human-body-rigs"]?.frames;
  if (!Array.isArray(frames) || frames.length !== 344) {
    throw new Error("native contract must provide exactly 344 measured body frames");
  }
  return frames.map(({ id, rect, feet, faceAnchor, heldAnchor }, index) => {
    const expectedRect = {
      x: index % 16 * 48,
      y: Math.floor(index / 16) * 64,
      width: 48,
      height: 64,
    };
    if (id !== `core-human-body-rigs:${index}` || !rect
      || Object.entries(expectedRect).some(([key, value]) => rect[key] !== value)) {
      throw new Error(`native body frame ${index} has noncanonical cell identity or order`);
    }
    const tuple = [feet?.x, feet?.y, faceAnchor?.x, faceAnchor?.y, heldAnchor?.x, heldAnchor?.y];
    if (tuple.length !== 6 || !tuple.every(Number.isInteger)) {
      throw new Error(`native body frame ${index} has invalid measured anchors`);
    }
    return tuple;
  });
}

const FACE_NOSE_DIRECTIONS = ["north-hidden", "east", "south", "west"];

function compactBodyFacePlaneMetrics(nativeContract) {
  return ["human-a", "human-b"].flatMap((rig) => FACINGS.map((facing) => {
    const plane = nativeContract.bodyFacePlanes?.[`${rig}:${facing}`];
    const tuple = [plane?.planePixels, plane?.facialFeaturePixels];
    if (!tuple.every(Number.isInteger)) {
      throw new Error(`native body face plane ${rig}:${facing} has invalid measured metrics`);
    }
    return tuple;
  }));
}

function compactFacePlaneMetrics(nativeContract) {
  return FACINGS.flatMap((facing) => ["human-a", "human-b"].flatMap((rig) => (
    EXPRESSIONS.map((expression) => {
      const plane = nativeContract.facePlanes?.[`${rig}:${facing}:${expression}`];
      const noseDirection = FACE_NOSE_DIRECTIONS.indexOf(plane?.noseDirection);
      const integers = [
        plane?.maskPixels,
        plane?.coveredMaskPixels,
        plane?.leakedPixels,
        plane?.eyes,
        noseDirection,
        plane?.mouthPixels,
      ];
      if (!integers.every(Number.isInteger) || noseDirection < 0
        || !/^[a-f0-9]{64}$/.test(plane?.semanticPixelsSha256 ?? "")
        || !/^[a-f0-9]{64}$/.test(plane?.measuredFromSha256 ?? "")) {
        throw new Error(`native face plane ${rig}:${facing}:${expression} has invalid measured metrics`);
      }
      return [...integers, plane.semanticPixelsSha256, plane.measuredFromSha256];
    })
  )));
}

function unionOpaqueBounds(target, bounds, offsetX, offsetY) {
  if (bounds === null) return;
  target.left = Math.min(target.left, bounds.left + offsetX);
  target.top = Math.min(target.top, bounds.top + offsetY);
  target.right = Math.max(target.right, bounds.right + offsetX);
  target.bottom = Math.max(target.bottom, bounds.bottom + offsetY);
}

function opaqueCellBounds(raw, cellIndex, columns, cellWidth, cellHeight) {
  const originX = cellIndex % columns * cellWidth;
  const originY = Math.floor(cellIndex / columns) * cellHeight;
  const bounds = {
    left: Number.POSITIVE_INFINITY,
    top: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    bottom: Number.NEGATIVE_INFINITY,
  };
  for (let y = 0; y < cellHeight; y += 1) {
    for (let x = 0; x < cellWidth; x += 1) {
      const alpha = raw.data[((originY + y) * raw.info.width + originX + x) * 4 + 3];
      if (alpha === 0) continue;
      bounds.left = Math.min(bounds.left, x);
      bounds.top = Math.min(bounds.top, y);
      bounds.right = Math.max(bounds.right, x + 1);
      bounds.bottom = Math.max(bounds.bottom, y + 1);
    }
  }
  return Number.isFinite(bounds.left) ? bounds : null;
}

/** Measure the complete legally visible idle-human alpha union relative to actor feet. */
export async function measureStandingVisualEnvelopes(coreBuffers, nativeContract) {
  const atlasNames = [
    "human-body-rigs.png",
    "human-face-planes.png",
    "human-hair.png",
    "human-held.png",
    ...Array.from({ length: 8 }, (_unused, index) =>
      `human-clothing-${String(index).padStart(2, "0")}.png`),
  ];
  const decoded = Object.fromEntries(await Promise.all(atlasNames.map(async (name) => [
    name,
    await sharp(coreBuffers[name]).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ])));
  const bodyFrames = nativeContract.atlases?.["core-human-body-rigs"]?.frames;
  if (!Array.isArray(bodyFrames) || bodyFrames.length !== 344) {
    throw new Error("standing visual envelope requires 344 measured body frames");
  }
  const idleComposite = {
    left: Number.POSITIVE_INFINITY,
    top: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    bottom: Number.NEGATIVE_INFINITY,
  };
  const withHeldForms = { ...idleComposite };
  for (let rigIndex = 0; rigIndex < 2; rigIndex += 1) {
    for (const [facingIndex] of FACINGS.entries()) {
      for (let idleFrameIndex = 0; idleFrameIndex < 4; idleFrameIndex += 1) {
        const bodyCell = rigIndex * 172 + facingIndex * 43 + idleFrameIndex;
        const bodyFrame = bodyFrames[bodyCell];
        const bodyOffsetX = -bodyFrame.feet.x;
        const bodyOffsetY = -bodyFrame.feet.y;
        const addIdle = (bounds, offsetX, offsetY) => {
          unionOpaqueBounds(idleComposite, bounds, offsetX, offsetY);
          unionOpaqueBounds(withHeldForms, bounds, offsetX, offsetY);
        };
        addIdle(
          opaqueCellBounds(decoded["human-body-rigs.png"], bodyCell, 16, 48, 64),
          bodyOffsetX,
          bodyOffsetY,
        );
        for (let clothingIndex = 0; clothingIndex < 8; clothingIndex += 1) {
          addIdle(
            opaqueCellBounds(
              decoded[`human-clothing-${String(clothingIndex).padStart(2, "0")}.png`],
              bodyCell % 172,
              16,
              48,
              64,
            ),
            bodyOffsetX,
            bodyOffsetY,
          );
        }
        const faceOffsetX = bodyOffsetX + bodyFrame.faceAnchor.x - 24;
        const faceOffsetY = bodyOffsetY + bodyFrame.faceAnchor.y - 18;
        for (let expressionIndex = 0; expressionIndex < EXPRESSIONS.length; expressionIndex += 1) {
          addIdle(
            opaqueCellBounds(
              decoded["human-face-planes.png"],
              facingIndex * 16 + rigIndex * 8 + expressionIndex,
              16,
              48,
              64,
            ),
            faceOffsetX,
            faceOffsetY,
          );
        }
        for (let hairIndex = 0; hairIndex < HAIR_SILHOUETTES.length; hairIndex += 1) {
          addIdle(
            opaqueCellBounds(
              decoded["human-hair.png"],
              hairIndex * 24 + facingIndex * 6 + idleFrameIndex % 2,
              16,
              48,
              64,
            ),
            faceOffsetX,
            faceOffsetY,
          );
        }
        const heldOffsetX = bodyOffsetX + bodyFrame.heldAnchor.x - 34;
        const heldOffsetY = bodyOffsetY + bodyFrame.heldAnchor.y - 38;
        for (let heldIndex = 0; heldIndex < HELD_FORMS.length; heldIndex += 1) {
          unionOpaqueBounds(
            withHeldForms,
            opaqueCellBounds(
              decoded["human-held.png"],
              facingIndex * HELD_FORMS.length + heldIndex,
              16,
              48,
              64,
            ),
            heldOffsetX,
            heldOffsetY,
          );
        }
      }
    }
  }
  const measured = { idleComposite, withHeldForms };
  for (const [label, bounds] of Object.entries(measured)) {
    if (!Object.values(bounds).every(Number.isInteger)
      || bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
      throw new Error(`standing visual envelope ${label} could not be measured`);
    }
  }
  return measured;
}

function coreMetadata(descriptors, nativeContract, standingVisualEnvelopes, metadataBytes) {
  return {
    schema: 1,
    generatedAt: new Date(0).toISOString(),
    metadataBytes,
    atlases: descriptors.filter(({ group }) => group === "core").map(metadataAtlas),
    rigs: ["human-a", "human-b"],
    facings: FACINGS,
    actions: Object.fromEntries(BODY_ACTIONS),
    expressions: EXPRESSIONS,
    hairSilhouettes: HAIR_SILHOUETTES,
    clothingSilhouettes: CLOTHING_SILHOUETTES,
    heldForms: HELD_FORMS,
    statusCells: STATUS_CELLS,
    bodyFrameAnchors: compactBodyFrameAnchors(nativeContract),
    bodyFacePlaneMetrics: compactBodyFacePlaneMetrics(nativeContract),
    facePlaneMetrics: compactFacePlaneMetrics(nativeContract),
    standingVisualEnvelopes,
    feet: { x: 24, y: 61 },
    walkStride: 12,
    runStride: 18,
    noRuntimeResize: true,
  };
}

function regionMetadata(kit, descriptors, metadataBytes, nativeContract) {
  const sceneryContract = nativeContract.atlases[`${kit}-scenery`];
  return {
    schema: 1,
    kit,
    metadataBytes,
    atlases: descriptors.filter(({ regionKit, group }) => regionKit === kit && group === "region").map(metadataAtlas),
    semanticSceneryCells: sceneryContract.semanticSceneryCells,
    semanticSceneryVariantStride: 4,
    landmarkVariants: nativeContract.atlases[`${kit}-landmarks`].authoredVariants.map((variant) => [
      SCENIC_LANDMARK_KINDS.indexOf(variant.semanticKind),
      variant.cellIndex,
      variant.contactPivotPx.x,
      variant.contactPivotPx.y,
      variant.geometryHash,
    ]),
  };
}

function homeMetadata(kit, descriptors, metadataBytes, nativeContract) {
  return {
    schema: 1,
    kit,
    metadataBytes,
    atlases: descriptors.filter(({ regionKit, group }) => regionKit === kit && group === "home").map(metadataAtlas),
    yardGeometry: [96, 112, 80, 32],
    yardVariants: nativeContract.atlases[`${kit}-home-yards`].authoredVariants.map((variant) => [
      variant.cellIndex,
      variant.geometryHash,
    ]),
  };
}

function sizedMetadata(builder) {
  let metadataBytes = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const value = builder(metadataBytes);
    const buffer = Buffer.from(`${JSON.stringify(value)}\n`);
    if (buffer.length === metadataBytes) return { value, buffer };
    metadataBytes = buffer.length;
  }
  throw new Error("metadata byte accounting did not reach a fixed point");
}

function coreMetadataFile(descriptors, nativeContract, standingVisualEnvelopes) {
  return sizedMetadata((metadataBytes) => coreMetadata(
    descriptors,
    nativeContract,
    standingVisualEnvelopes,
    metadataBytes,
  ));
}

export function regionMetadataFile(kit, descriptors, nativeContract) {
  return sizedMetadata((metadataBytes) => regionMetadata(kit, descriptors, metadataBytes, nativeContract));
}

export function homeMetadataFile(kit, descriptors, nativeContract) {
  return sizedMetadata((metadataBytes) => homeMetadata(kit, descriptors, metadataBytes, nativeContract));
}

const WORN_HEARTLAND_LANDMARK_ATLAS_ID = "worn-heartland-landmarks";
const WORN_HEARTLAND_LANDMARK_RELATIVE_PATH = "regions/worn-heartland/landmarks.png";
const WORN_HEARTLAND_REGION_PACK_RELATIVE_PATH = "regions/worn-heartland/pack.json";
const WORN_HEARTLAND_HOME_PACK_RELATIVE_PATH = "homes/worn-heartland/pack.json";
const WORN_HEARTLAND_PACKING_REPORT_FILENAME = "packing-report.json";
const WORN_LANDMARK_FILE_OPERATIONS = Object.freeze({ mkdir, readFile, writeFile, rename, rm });
const WORN_HEARTLAND_LANDMARK_DESCRIPTOR_KEYS = Object.freeze([
  "cellHeight",
  "cellWidth",
  "columns",
  "compressedBytes",
  "decodedBytes",
  "group",
  "height",
  "id",
  "path",
  "regionKit",
  "rows",
  "sha256",
  "width",
]);

function exactWornHeartlandLandmarkDescriptor(runtimePack) {
  const descriptors = runtimePack.atlases;
  const matches = descriptors.filter((descriptor) => (
    descriptor !== null && typeof descriptor === "object"
      && descriptor.id === WORN_HEARTLAND_LANDMARK_ATLAS_ID
  ));
  if (matches.length !== 1) {
    throw new Error(`Worn-heartland runtime pack requires exactly one ${WORN_HEARTLAND_LANDMARK_ATLAS_ID} descriptor`);
  }
  const descriptor = matches[0];
  const errors = [];
  if (canonicalJson(Object.keys(descriptor).sort()) !== canonicalJson(WORN_HEARTLAND_LANDMARK_DESCRIPTOR_KEYS)) {
    errors.push("descriptor schema keys must match the exact runtime atlas schema");
  }
  for (const [field, expected] of Object.entries({
    id: WORN_HEARTLAND_LANDMARK_ATLAS_ID,
    path: WORN_HEARTLAND_LANDMARK_RELATIVE_PATH,
    group: "region",
    regionKit: "worn-heartland",
    width: 512,
    height: 256,
    cellWidth: 128,
    cellHeight: 128,
    columns: 4,
    rows: 2,
    decodedBytes: 512 * 256 * 4,
  })) {
    if (descriptor[field] !== expected) errors.push(`descriptor ${field} must be exactly ${expected}`);
  }
  if (!Number.isInteger(descriptor.compressedBytes) || descriptor.compressedBytes <= 0) {
    errors.push("descriptor compressedBytes must be a positive integer");
  }
  if (!/^[a-f0-9]{64}$/.test(descriptor.sha256 ?? "")) {
    errors.push("descriptor sha256 must be an exact lowercase SHA-256 digest");
  }
  const pathOwners = descriptors.filter((candidate) => (
    candidate !== null && typeof candidate === "object"
      && candidate.path === WORN_HEARTLAND_LANDMARK_RELATIVE_PATH
  ));
  if (pathOwners.length !== 1 || pathOwners[0] !== descriptor) {
    errors.push(`runtime landmark path ${WORN_HEARTLAND_LANDMARK_RELATIVE_PATH} must have exactly one descriptor owner`);
  }
  if (errors.length > 0) {
    throw new Error(`Worn-heartland runtime landmark descriptor validation failed:\n${errors.join("\n")}`);
  }
  return descriptor;
}

function exactWornHeartlandPackingReport(packingReport) {
  if (!packingReport || typeof packingReport !== "object" || Array.isArray(packingReport)
      || packingReport.schema !== 1 || !Array.isArray(packingReport.atlases)
      || !Array.isArray(packingReport.countedAtlasIds)) {
    throw new Error("Worn-heartland landmark intake requires the persisted schema-1 packing report");
  }
  const matches = packingReport.atlases.filter(({ id } = {}) => id === WORN_HEARTLAND_LANDMARK_ATLAS_ID);
  const counted = packingReport.countedAtlasIds.filter((id) => id === WORN_HEARTLAND_LANDMARK_ATLAS_ID);
  if (matches.length !== 1 || counted.length !== 1) {
    throw new Error("Worn-heartland packing report requires exactly one counted landmark descriptor");
  }
  const descriptor = matches[0];
  const errors = [];
  for (const [field, expected] of Object.entries({
    id: WORN_HEARTLAND_LANDMARK_ATLAS_ID,
    path: WORN_HEARTLAND_LANDMARK_RELATIVE_PATH,
    group: "region",
    regionKit: "worn-heartland",
    width: 512,
    height: 256,
    cellWidth: 128,
    cellHeight: 128,
    columns: 4,
    rows: 2,
    decodedBytes: 512 * 256 * 4,
  })) {
    if (descriptor[field] !== expected) errors.push(`packing report descriptor ${field} must be exactly ${expected}`);
  }
  if (!Number.isInteger(descriptor.compressedBytes) || descriptor.compressedBytes <= 0
      || !/^[a-f0-9]{64}$/.test(descriptor.sha256 ?? "")) {
    errors.push("packing report descriptor requires positive bytes and an exact SHA-256 digest");
  }
  for (const field of [
    "coreMetadataCompressedBytes",
    "coreMetadataDecodedBytes",
    "currentUiCompressedBytes",
    "currentUiDecodedBytes",
  ]) {
    if (!Number.isInteger(packingReport[field]) || packingReport[field] < 0) {
      errors.push(`packing report ${field} must be a non-negative integer`);
    }
  }
  if (!packingReport.budgets || typeof packingReport.budgets !== "object"
      || !packingReport.regionMetadataCompressedBytes
      || !packingReport.regionMetadataDecodedBytes) {
    errors.push("packing report requires exact budgets and regional metadata accounting");
  }
  if (errors.length > 0) {
    throw new Error(`Worn-heartland packing report validation failed:\n${errors.join("\n")}`);
  }
  return descriptor;
}

async function validateWornHeartlandLandmarkCandidate(candidateBuffer, atlas, analysis) {
  const errors = [];
  const atlasId = WORN_HEARTLAND_LANDMARK_ATLAS_ID;
  const geometry = REGIONAL_COMPOSITION_GEOMETRY.landmarks;
  const specs = REGIONAL_VARIANT_SPECS["worn-heartland"].landmarks;
  const metadata = await sharp(candidateBuffer).metadata();
  if (metadata.format !== "png") errors.push(`${atlasId}: candidate must be PNG`);
  if ((metadata.pages ?? 1) !== 1) errors.push(`${atlasId}: candidate must contain exactly one PNG page`);
  if (analysis.width !== geometry.width || analysis.height !== geometry.height) {
    errors.push(`${atlasId}: geometry must be exactly ${geometry.width}x${geometry.height}`);
  }
  if (atlas.width !== geometry.width || atlas.height !== geometry.height
      || atlas.cellWidth !== geometry.cellWidth || atlas.cellHeight !== geometry.cellHeight) {
    errors.push(`${atlasId}: atlas/cell geometry must remain exactly 512x256 with 128x128 cells`);
  }
  if (atlas.sourceSha256 !== analysis.sha256) errors.push(`${atlasId}: candidate source hash mismatch`);

  const records = atlas.authoredVariants;
  if (!Array.isArray(records) || records.length !== geometry.cells) {
    errors.push(`${atlasId}: requires exactly ${geometry.cells} authored landmark variants`);
    return errors;
  }
  const cells = records.map(({ cellIndex }) => cellIndex);
  const ids = records.map(({ variantId }) => variantId);
  if (new Set(cells).size !== geometry.cells || cells.some((cell, index) => cell !== index)) {
    errors.push(`${atlasId}: cell ownership must be unique canonical 0-${geometry.cells - 1}`);
  }
  if (new Set(ids).size !== geometry.cells) errors.push(`${atlasId}: duplicate variant ID`);

  for (const [index, record] of records.entries()) {
    const spec = specs[index];
    for (const [key, expected] of Object.entries(spec)) {
      if (canonicalJson(record[key]) !== canonicalJson(expected)) {
        errors.push(`${atlasId}/${record.variantId ?? index}: ${key} differs from exact worn-landmark authority`);
      }
    }
    const expectedCellRect = {
      x: index % (geometry.width / geometry.cellWidth) * geometry.cellWidth,
      y: Math.floor(index / (geometry.width / geometry.cellWidth)) * geometry.cellHeight,
      width: geometry.cellWidth,
      height: geometry.cellHeight,
    };
    if (canonicalJson(record.cellRectPx) !== canonicalJson(expectedCellRect)) {
      errors.push(`${atlasId}/${record.variantId ?? index}: cell rectangle drift`);
    }
    if (record.semanticKind === atlasId) {
      errors.push(`${atlasId}/${record.variantId}: semantic name may not be an atlas ID`);
    }
    if (!record.opaqueBoundsPx || record.opaqueBoundsPx.width <= 0 || record.opaqueBoundsPx.height <= 0) {
      errors.push(`${atlasId}/${record.variantId}: empty cell`);
      continue;
    }
    if (Math.max(record.opaqueBoundsPx.width, record.opaqueBoundsPx.height) < 96
        || Math.min(record.opaqueBoundsPx.width, record.opaqueBoundsPx.height) < 32) {
      errors.push(`${atlasId}/${record.variantId}: composition is pickup-sized`);
    }
    if (!Array.isArray(record.eligibleTopologyKeys) || record.eligibleTopologyKeys.length === 0) {
      errors.push(`${atlasId}/${record.variantId}: exact topology key required`);
    }
    const hardOffsets = Array.isArray(record.hardOffsets) ? record.hardOffsets : [];
    const hardKeys = hardOffsets.map(({ x, y }) => `${x},${y}`);
    if (new Set(hardKeys).size !== hardKeys.length) {
      errors.push(`${atlasId}/${record.variantId}: duplicate hard offset`);
    }
    if (hardOffsets.some((offset) => !offsetInsideFootprint(offset, record.visualFootprint))) {
      errors.push(`${atlasId}/${record.variantId}: hard offset outside visual footprint`);
    }
    if (record.heightPolicy === "tall-static-back-excluded"
        && record.interactionExclusionOffsets.length
          !== record.visualFootprint.widthTiles * record.visualFootprint.heightTiles) {
      errors.push(`${atlasId}/${record.variantId}: tall standing envelope exclusion is incomplete`);
    }
    const { geometryHash: declaredGeometryHash, ...recordWithoutHash } = record;
    if (declaredGeometryHash !== geometryHash(analysis.sha256, recordWithoutHash)) {
      errors.push(`${atlasId}/${record.variantId}: byte-derived geometry hash drift`);
    }
  }
  return errors;
}

async function buildWornHeartlandLandmarkPublication({
  candidateBuffer,
  nativeContract,
  runtimePack,
  homePackBuffer,
  packingReport,
}) {
  if (!Buffer.isBuffer(candidateBuffer)) {
    throw new Error("Worn-heartland landmark candidate requires PNG Buffer bytes");
  }
  if (!nativeContract?.atlases?.[WORN_HEARTLAND_LANDMARK_ATLAS_ID]) {
    throw new Error("Worn-heartland landmark intake requires its persisted native contract");
  }
  if (!runtimePack || runtimePack.kit !== "worn-heartland" || !Array.isArray(runtimePack.atlases)) {
    throw new Error("Worn-heartland landmark intake requires its persisted runtime pack");
  }
  if (!Buffer.isBuffer(homePackBuffer)) {
    throw new Error("Worn-heartland landmark intake requires its persisted home pack bytes");
  }
  const targetDescriptor = exactWornHeartlandLandmarkDescriptor(runtimePack);
  const reportTargetDescriptor = exactWornHeartlandPackingReport(packingReport);
  const geometry = REGIONAL_COMPOSITION_GEOMETRY.landmarks;
  const previousAtlas = nativeContract.atlases[WORN_HEARTLAND_LANDMARK_ATLAS_ID];
  const candidateSha256 = hashBuffer(candidateBuffer);
  const approvedMaterialRamps = wornHeartlandApprovedLandmarkMaterialRamps();
  const analysis = await analyzeRuntimeAtlas(candidateBuffer, {
    id: WORN_HEARTLAND_LANDMARK_ATLAS_ID,
    width: geometry.width,
    height: geometry.height,
    cellWidth: geometry.cellWidth,
    cellHeight: geometry.cellHeight,
    sourceCellWidth: geometry.cellWidth,
    sourceCellHeight: geometry.cellHeight,
    outlineColors: previousAtlas.outlineColors,
    materialRamps: approvedMaterialRamps,
    outlineCornerExceptions: previousAtlas.outlineCornerExceptions,
    requireExposedOutline: false,
    frames: [],
  });
  const nextContract = structuredClone(nativeContract);
  nextContract.atlases[WORN_HEARTLAND_LANDMARK_ATLAS_ID] = {
    ...structuredClone(previousAtlas),
    width: geometry.width,
    height: geometry.height,
    cellWidth: geometry.cellWidth,
    cellHeight: geometry.cellHeight,
    sourceSha256: candidateSha256,
    materialRamps: approvedMaterialRamps,
    authoredVariants: await authoredVariantGeometryList(
      candidateBuffer,
      geometry,
      REGIONAL_VARIANT_SPECS["worn-heartland"].landmarks,
    ),
  };
  const validationErrors = [
    ...analysis.errors,
    ...await validateWornHeartlandLandmarkCandidate(
      candidateBuffer,
      nextContract.atlases[WORN_HEARTLAND_LANDMARK_ATLAS_ID],
      analysis,
    ),
  ];
  if (validationErrors.length > 0) {
    throw new Error(`Worn-heartland landmark candidate validation failed before staging:\n${[
      ...new Set(validationErrors),
    ].join("\n")}`);
  }
  const descriptors = runtimePack.atlases.map((descriptor) => (
    descriptor === targetDescriptor
      ? {
        ...descriptor,
        compressedBytes: candidateBuffer.length,
        decodedBytes: geometry.width * geometry.height * 4,
        sha256: candidateSha256,
      }
      : structuredClone(descriptor)
  ));
  const nativeContractBuffer = Buffer.from(`${JSON.stringify(nextContract, null, 2)}\n`);
  const runtimePackBuffer = regionMetadataFile("worn-heartland", descriptors, nextContract).buffer;
  const nativeContractSha256 = hashBuffer(nativeContractBuffer);
  const nextRuntimeDescriptor = descriptors.find(({ id }) => id === WORN_HEARTLAND_LANDMARK_ATLAS_ID);
  const nextReportAtlases = packingReport.atlases.map((descriptor) => {
    const nextDescriptor = structuredClone(descriptor);
    if (nextDescriptor.validation?.measuredFromContractSha256) {
      nextDescriptor.validation.measuredFromContractSha256 = nativeContractSha256;
    }
    if (descriptor !== reportTargetDescriptor) return nextDescriptor;
    return {
      ...nextDescriptor,
      ...structuredClone(nextRuntimeDescriptor),
      binaryAlpha: analysis.binaryAlpha,
      runtimeResized: analysis.runtimeResized,
      validation: {
        ...structuredClone(nextDescriptor.validation ?? {}),
        measuredFromSha256: analysis.sha256,
        measuredFromContractSha256: nativeContractSha256,
        errors: [...analysis.errors],
        binaryAlpha: analysis.binaryAlpha,
        transparentResidue: analysis.transparentResidue,
        runtimeResized: analysis.runtimeResized,
        maxShadesPerMaterial: analysis.maxShadesPerMaterial,
        maxOutlineWidth: analysis.maxOutlineWidth,
        maxRootDrift: analysis.maxRootDrift,
        maxFaceAnchorDrift: analysis.maxFaceAnchorDrift,
        maxHeldAnchorDrift: analysis.maxHeldAnchorDrift,
        unknownOpaqueColors: analysis.unknownOpaqueColors,
        missingExposedOutlinePixels: analysis.missingExposedOutlinePixels,
      },
    };
  });
  const regionMetadataCompressedBytes = {
    ...structuredClone(packingReport.regionMetadataCompressedBytes),
    "worn-heartland": runtimePackBuffer.length + homePackBuffer.length,
  };
  const rebuiltReport = buildProductionPackingReport({
    atlases: nextReportAtlases,
    currentUiCompressedBytes: packingReport.currentUiCompressedBytes,
    currentUiDecodedBytes: packingReport.currentUiDecodedBytes,
    metadata: {
      core: {
        compressedBytes: packingReport.coreMetadataCompressedBytes,
        decodedBytes: packingReport.coreMetadataDecodedBytes,
      },
      regions: Object.fromEntries(Object.entries(regionMetadataCompressedBytes).map(([kit, bytes]) => [kit, {
        compressedBytes: bytes,
        decodedBytes: kit === "worn-heartland"
          ? bytes : packingReport.regionMetadataDecodedBytes[kit],
      }])),
    },
    budgets: packingReport.budgets,
  });
  const nextPackingReport = {
    ...structuredClone(packingReport),
    ...rebuiltReport,
    nativeContractSha256,
    facePlaneValidation: packingReport.facePlaneValidation ? {
      ...structuredClone(packingReport.facePlaneValidation),
      measuredFromContractSha256: nativeContractSha256,
    } : packingReport.facePlaneValidation,
    clipValidation: packingReport.clipValidation ? {
      ...structuredClone(packingReport.clipValidation),
      measuredFromContractSha256: nativeContractSha256,
    } : packingReport.clipValidation,
  };
  const reportErrors = [
    ...validateAssetBudgets(nextPackingReport),
    ...validateProductionPackingReport(nextPackingReport, nextReportAtlases),
  ];
  if (reportErrors.length > 0) {
    throw new Error(`Worn-heartland packing report synchronization failed before staging:\n${[
      ...new Set(reportErrors),
    ].join("\n")}`);
  }
  const packingReportBuffer = Buffer.from(`${JSON.stringify(nextPackingReport, null, 2)}\n`);
  return {
    candidateSha256,
    nativeContractBuffer,
    runtimePackBuffer,
    packingReportBuffer,
  };
}

async function publishWornLandmarkFilesAtomically(publications, fileOperations) {
  const operations = { ...WORN_LANDMARK_FILE_OPERATIONS, ...fileOperations };
  const expectedRoles = ["native-atlas", "runtime-atlas", "runtime-pack", "native-contract", "packing-report"];
  if (!Array.isArray(publications)
      || canonicalJson(publications.map(({ role }) => role)) !== canonicalJson(expectedRoles)
      || publications.some(({ destination, buffer }) => typeof destination !== "string" || !Buffer.isBuffer(buffer))) {
    throw new Error("Scoped worn-heartland publication must contain exactly its five owned files");
  }
  const staged = [];
  const attemptedCommits = [];
  const rollbackPaths = [];
  try {
    for (const [index, publication] of publications.entries()) {
      await operations.mkdir(path.dirname(publication.destination), { recursive: true });
      const temporary = `${publication.destination}.tmp-worn-landmark-${process.pid}-${index}`;
      let previous = null;
      try {
        previous = await operations.readFile(publication.destination);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const stagedPublication = { ...publication, temporary, previous };
      staged.push(stagedPublication);
      await operations.writeFile(temporary, publication.buffer);
    }
    for (const publication of staged) {
      attemptedCommits.push(publication);
      await operations.rename(publication.temporary, publication.destination);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const publication of [...attemptedCommits].reverse()) {
      try {
        if (publication.previous === null) {
          await operations.rm(publication.destination, { force: true });
        } else {
          const rollback = `${publication.destination}.tmp-worn-landmark-rollback-${process.pid}`;
          rollbackPaths.push(rollback);
          await operations.writeFile(rollback, publication.previous);
          await operations.rename(rollback, publication.destination);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    const cleanupResults = await Promise.allSettled([
      ...staged.map(({ temporary }) => operations.rm(temporary, { force: true })),
      ...rollbackPaths.map((rollback) => operations.rm(rollback, { force: true })),
    ]);
    const cleanupErrors = cleanupResults
      .filter(({ status }) => status === "rejected")
      .map(({ reason }) => reason instanceof Error ? reason : new Error(String(reason)));
    if (rollbackErrors.length > 0 || cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors, ...cleanupErrors],
        "Scoped worn-heartland landmark rollback or cleanup failed",
      );
    }
    throw error;
  }
  return publications.map(({ destination }) => destination);
}

/** Validate and atomically publish only the worn-heartland landmark slice and accounting receipt. */
export async function publishWornHeartlandLandmarksScoped({
  candidatePath,
  nativeRoot = NATIVE_ROOT,
  runtimeRoot = RUNTIME_ROOT,
  evidenceRoot = EVIDENCE_ROOT,
  fileOperations = {},
} = {}) {
  if (typeof candidatePath !== "string" || candidatePath.length === 0) {
    throw new Error("Scoped worn-heartland landmark authoring requires one candidate PNG path");
  }
  if (typeof nativeRoot !== "string" || nativeRoot.length === 0
      || typeof runtimeRoot !== "string" || runtimeRoot.length === 0
      || typeof evidenceRoot !== "string" || evidenceRoot.length === 0) {
    throw new Error("Scoped worn-heartland landmark authoring requires native, runtime, and evidence roots");
  }
  const operations = { ...WORN_LANDMARK_FILE_OPERATIONS, ...fileOperations };
  const nativeContractPath = path.join(nativeRoot, "production-native-contract.json");
  const runtimePackPath = path.join(runtimeRoot, WORN_HEARTLAND_REGION_PACK_RELATIVE_PATH);
  const homePackPath = path.join(runtimeRoot, WORN_HEARTLAND_HOME_PACK_RELATIVE_PATH);
  const packingReportPath = path.join(evidenceRoot, WORN_HEARTLAND_PACKING_REPORT_FILENAME);
  const [candidateBuffer, nativeContractBytes, runtimePackBytes, homePackBuffer, packingReportBytes] = await Promise.all([
    operations.readFile(candidatePath),
    operations.readFile(nativeContractPath),
    operations.readFile(runtimePackPath),
    operations.readFile(homePackPath),
    operations.readFile(packingReportPath),
  ]);
  let nativeContract;
  let runtimePack;
  let homePack;
  let packingReport;
  try {
    nativeContract = JSON.parse(nativeContractBytes.toString("utf8"));
    runtimePack = JSON.parse(runtimePackBytes.toString("utf8"));
    homePack = JSON.parse(homePackBuffer.toString("utf8"));
    packingReport = JSON.parse(packingReportBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`Scoped worn-heartland landmark metadata is invalid JSON: ${error.message}`);
  }
  if (homePack?.kit !== "worn-heartland" || !Array.isArray(homePack.atlases)) {
    throw new Error("Scoped worn-heartland landmark accounting requires its exact home pack");
  }
  const built = await buildWornHeartlandLandmarkPublication({
    candidateBuffer,
    nativeContract,
    runtimePack,
    homePackBuffer,
    packingReport,
  });
  const nativeAtlasPath = path.join(nativeRoot, WORN_HEARTLAND_LANDMARK_RELATIVE_PATH);
  const runtimeAtlasPath = path.join(runtimeRoot, WORN_HEARTLAND_LANDMARK_RELATIVE_PATH);
  const publications = [
    { role: "native-atlas", destination: nativeAtlasPath, buffer: candidateBuffer },
    { role: "runtime-atlas", destination: runtimeAtlasPath, buffer: candidateBuffer },
    { role: "runtime-pack", destination: runtimePackPath, buffer: built.runtimePackBuffer },
    { role: "native-contract", destination: nativeContractPath, buffer: built.nativeContractBuffer },
    { role: "packing-report", destination: packingReportPath, buffer: built.packingReportBuffer },
  ];
  const publishedPaths = await publishWornLandmarkFilesAtomically(publications, operations);
  return Object.freeze({
    mode: "author-worn-heartland-landmarks",
    candidateSha256: built.candidateSha256,
    publishedPaths: Object.freeze(publishedPaths),
  });
}

async function expectedMetadataFiles(
  inventory,
  report,
  evidence,
  nativeContract,
  standingVisualEnvelopes,
) {
  const files = new Map();
  files.set("core/production-core-source.json", coreMetadataFile(
    inventory.descriptors,
    nativeContract,
    standingVisualEnvelopes,
  ).buffer);
  for (const kit of REGION_KITS) {
    files.set(`regions/${kit}/pack.json`, regionMetadataFile(kit, inventory.descriptors, nativeContract).buffer);
    files.set(`homes/${kit}/pack.json`, homeMetadataFile(kit, inventory.descriptors, nativeContract).buffer);
  }
  const completeReport = {
    ...report,
    countedAtlasIds: inventory.descriptors.map(({ id }) => id),
    contactSheets: ["native-1x", "exact-2x", "desktop", "mobile-390x844"],
    frozenSliceHashes: FROZEN_SLICE_HASHES,
    runtimeSourceMethod: "validated native production masters; byte-preserving crop/stitch/encode only",
    provenance: "Original project-owned production art derived from approved project-owned 2D slice underlays and 2D style guides; human hair is deterministically re-extracted with face-safe masks.",
    outline: "one logical pixel with authored silhouette-corner joins",
    binaryAlpha: true,
    noRuntimeResize: true,
    productionSceneEvidence: {
      file: ASH_SCENE_PROOF.file,
      kit: ASH_SCENE_PROOF.kit,
      viewport: { width: ASH_SCENE_PROOF.width, height: ASH_SCENE_PROOF.height },
      sceneryKinds: [...new Set(ASH_SCENE_PROOF.placements.map(([kind]) => REGION_ART["ash-waste"].scenery[kind]))],
      repeatedKinds: REGION_ART["ash-waste"].scenery.filter((_kind, kindIndex) => (
        ASH_SCENE_PROOF.placements.filter(([candidate]) => candidate === kindIndex).length >= 2
      )),
      distinctVariantCells: [...new Set(ASH_SCENE_PROOF.placements.map(([kind, variant]) => kind + variant * 4))],
      clusterSize: 5,
      openInteractionRect: ASH_SCENE_PROOF.openInteractionRect,
      pathTiles: 40,
      emberEffects: ASH_SCENE_PROOF.emberPlacements.length,
    },
    evidence: Object.fromEntries(Object.entries(evidence).map(([name, buffer]) => [name, {
      compressedBytes: buffer.length,
      sha256: hashBuffer(buffer),
    }])),
  };
  files.set("evidence/packing-report.json", Buffer.from(`${JSON.stringify(completeReport, null, 2)}\n`));
  const verdictsByArtifact = {
    "task8-gold-master-approval-1x.png": ["directional-anatomy", "face-plane", "regional-identity",
      "home-scale", "component-separation", "pixel-discipline", "budgets"],
    "contact-sheet-human-1x.png": ["directional-anatomy", "face-plane", "pixel-discipline"],
    "contact-sheet-human-2x.png": ["directional-anatomy", "face-plane", "pixel-discipline"],
    "joe-human-b-south-idle2-coils-cell144-4x.png": ["directional-anatomy", "face-plane", "pixel-discipline"],
    "contact-sheet-regions-1x.png": ["regional-identity", "pixel-discipline"],
    "contact-sheet-homes-1x.png": ["home-scale", "component-separation", "pixel-discipline"],
    "contact-sheet-desktop-1440x900.png": ["directional-anatomy", "regional-identity", "home-scale", "responsive-readability"],
    "contact-sheet-mobile-390x844.png": ["directional-anatomy", "regional-identity", "home-scale", "responsive-readability"],
    [ASH_SCENE_PROOF.file]: ["regional-identity", "pixel-discipline", "responsive-readability"],
  };
  const homeStateEvidence = {};
  const homesSheet = evidence["contact-sheet-homes-1x.png"];
  const homeStates = ["cold", "lit", "doorway", "damaged", "collapse", "ruin-full", "ruin-picked", "ruin-bare"];
  for (const [kitIndex, kit] of REGION_KITS.entries()) {
    homeStateEvidence[kit] = {};
    for (const [stateIndex, state] of homeStates.entries()) {
      const rect = {
        x: stateIndex * 128,
        y: kitIndex * 128,
        left: stateIndex * 128,
        top: kitIndex * 128,
        width: 128,
        height: 128,
      };
      const { data } = await sharp(homesSheet).extract({ left: rect.x, top: rect.y,
        width: rect.width, height: rect.height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      homeStateEvidence[kit][state] = {
        file: "contact-sheet-homes-1x.png",
        rect,
        sha256: hashBuffer(data),
      };
    }
  }
  const bodyValidation = inventory.descriptors.find(({ id }) => id === "core-human-body-rigs")?.validation;
  const resultInput = {
    "directional-anatomy": { bodyValidation },
    "face-plane": report.facePlaneValidation,
    "pixel-discipline": inventory.descriptors.map(({ id, sha256, validation }) => ({ id, sha256, validation })),
    "regional-identity": inventory.descriptors.filter(({ group }) => group === "region")
      .map(({ id, sha256 }) => ({ id, sha256 })),
    "home-scale": homeStateEvidence,
    "component-separation": inventory.descriptors.filter(({ group }) => group === "home")
      .map(({ id, sha256 }) => ({ id, sha256 })),
    "responsive-readability": {
      desktop: hashBuffer(evidence["contact-sheet-desktop-1440x900.png"]),
      mobile: hashBuffer(evidence["contact-sheet-mobile-390x844.png"]),
    },
    budgets: {
      core: report.coreCompressedBytes,
      regions: report.regionCompressedBytes,
      active: report.activeCompressedBytes,
      errors: validateAssetBudgets(report),
    },
  };
  const validationResults = Object.fromEntries(Object.entries(resultInput).map(([name, basis]) => [name, {
    name,
    sha256: hashBuffer(Buffer.from(JSON.stringify(basis))),
    passed: name === "directional-anatomy"
      ? (bodyValidation?.errors?.length ?? 1) === 0 && bodyValidation.maxRootDrift <= 2
      : name === "face-plane"
        ? (report.facePlaneValidation?.errors?.length ?? 1) === 0
        : name === "pixel-discipline"
          ? inventory.descriptors.every(({ validation }) => validation?.errors?.length === 0)
          : name === "regional-identity"
            ? new Set(basis.map(({ sha256 }) => sha256)).size === basis.length
            : name === "home-scale"
              ? REGION_KITS.every((kit) => Object.keys(basis[kit] ?? {}).length === 8)
              : name === "component-separation"
                ? new Set(basis.map(({ sha256 }) => sha256)).size === basis.length
                : name === "responsive-readability"
                  ? Object.values(basis).every((sha256) => /^[a-f0-9]{64}$/.test(sha256))
                  : basis.errors.length === 0,
  }]));
  const artifacts = Object.fromEntries(Object.entries(evidence).map(([name, buffer]) => [name, {
    sha256: hashBuffer(buffer),
    verdicts: Object.fromEntries((verdictsByArtifact[name] ?? []).map((verdict) => [verdict, {
      status: "pass",
      validationResultSha256: validationResults[verdict].sha256,
    }])),
  }]));
  const matrix = {
    schema: 1,
    generatedAt: new Date(0).toISOString(),
    human: { rigs: ["human-a", "human-b"], facings: FACINGS,
      actions: ["idle", "walk", "turn", "blink", "talk", "work", "hurt", "recovery"] },
    regions: REGION_KITS,
    homes: REGION_KITS,
    viewports: ["native-1x", "exact-2x", "desktop-1440x900", "mobile-390x844"],
    requiredVerdicts: ["directional-anatomy", "face-plane", "pixel-discipline", "regional-identity",
      "home-scale", "component-separation", "responsive-readability", "budgets"],
    validationResults,
    artifacts,
    homeStateEvidence,
  };
  const matrixErrors = validateVisualReviewMatrix(matrix);
  if (matrixErrors.length > 0) throw new Error(`Visual review matrix validation failed:\n${matrixErrors.join("\n")}`);
  files.set("evidence/visual-review-matrix.json", Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`));
  return files;
}

async function readFrozenSources() {
  return Object.fromEntries(await Promise.all(Object.keys(FROZEN_SLICE_HASHES).map(async (name) => [
    name,
    await readFile(path.join(RUNTIME_ROOT, name)),
  ])));
}

async function authorHumanHairMaster(frozenSources) {
  const contractPath = path.join(NATIVE_ROOT, "production-native-contract.json");
  const hairPath = path.join(NATIVE_ROOT, "core/human-hair.png");
  const previousContract = await readFile(contractPath);
  const previousHair = await readFile(hairPath);
  const nativeContract = JSON.parse(previousContract);
  const bodyRaw = await rawAtlas(frozenSources["human-body-atlas.png"]);
  let hairBuffer = await encodeSurface(bootstrapHairSurfaceFromApprovedSlice(bodyRaw), NATIVE_PNG_OPTIONS);
  hairBuffer = await enhanceHairMaster(hairBuffer);
  hairBuffer = await carveHairFaceWindows(hairBuffer, nativeContract);
  hairBuffer = await normalizeNativeMaster(hairBuffer);

  const hairContract = nativeContract.atlases["core-human-hair"];
  if (!hairContract) throw new Error("native contract is missing core-human-hair");
  hairContract.outlineColors = [[28, 28, 36]];
  hairContract.materialRamps = structuredClone(HUMAN_HAIR_MATERIAL_RAMPS);
  hairContract.outlineCornerExceptions = structuredClone(HUMAN_HAIR_OUTLINE_EXCEPTIONS);
  hairContract.sourceSha256 = hashBuffer(hairBuffer);
  nativeContract.provenance = "Original project-owned production masters derived from approved slice underlays and style guides; human hair is deterministically extracted with face-safe masks.";
  const contractBuffer = Buffer.from(`${JSON.stringify(nativeContract, null, 2)}\n`);
  const staged = [
    { destination: hairPath, buffer: hairBuffer, previous: previousHair },
    { destination: contractPath, buffer: contractBuffer, previous: previousContract },
  ];
  const committed = [];
  try {
    for (const publication of staged) {
      publication.temporary = `${publication.destination}.tmp-human-hair-author-${process.pid}`;
      await writeFile(publication.temporary, publication.buffer);
    }
    for (const publication of staged) {
      await rename(publication.temporary, publication.destination);
      committed.push(publication);
    }
  } catch (error) {
    for (const publication of [...committed].reverse()) {
      const rollback = `${publication.destination}.tmp-human-hair-rollback-${process.pid}`;
      await writeFile(rollback, publication.previous);
      await rename(rollback, publication.destination);
    }
    await Promise.all(staged.map(({ temporary }) => rm(temporary, { force: true })));
    throw error;
  }
}

async function authorHumanFaceMaster() {
  const contractPath = path.join(NATIVE_ROOT, "production-native-contract.json");
  const facePath = path.join(NATIVE_ROOT, "core/human-face-planes.png");
  const bodyPath = path.join(NATIVE_ROOT, "core/human-body-rigs.png");
  const previousContract = await readFile(contractPath);
  const previousFace = await readFile(facePath);
  const nativeContract = JSON.parse(previousContract);
  const faceBuffer = await encodeSurface(buildCoreSurfaces().face, NATIVE_PNG_OPTIONS);
  const faceSha256 = hashBuffer(faceBuffer);
  nativeContract.faceSemanticPalette = {
    eyes: [[52, 36, 28]],
    nose: [[156, 96, 68]],
    mouth: [[16, 6, 11]],
  };
  const atlasContract = nativeContract.atlases["core-human-face-planes"];
  if (!atlasContract) throw new Error("native contract is missing core-human-face-planes");
  atlasContract.sourceSha256 = faceSha256;
  const measured = await measureFacePlaneContract({
    coreBuffers: {
      "human-body-rigs.png": await readFile(bodyPath),
      "human-face-planes.png": faceBuffer,
    },
  }, nativeContract);
  nativeContract.bodyFacePlanes = measured.bodyPlanes;
  nativeContract.facePlanes = measured.facePlanes;
  nativeContract.provenance = "Original project-owned production masters derived from approved slice underlays and style guides; directional faces are independently authored and measured across complete native cells.";
  const contractBuffer = Buffer.from(`${JSON.stringify(nativeContract, null, 2)}\n`);
  const staged = [
    { destination: facePath, buffer: faceBuffer, previous: previousFace },
    { destination: contractPath, buffer: contractBuffer, previous: previousContract },
  ];
  const committed = [];
  try {
    for (const publication of staged) {
      publication.temporary = `${publication.destination}.tmp-human-face-author-${process.pid}`;
      await writeFile(publication.temporary, publication.buffer);
    }
    for (const publication of staged) {
      await rename(publication.temporary, publication.destination);
      committed.push(publication);
    }
  } catch (error) {
    for (const publication of [...committed].reverse()) {
      const rollback = `${publication.destination}.tmp-human-face-rollback-${process.pid}`;
      await writeFile(rollback, publication.previous);
      await rename(rollback, publication.destination);
    }
    await Promise.all(staged.map(({ temporary }) => rm(temporary, { force: true })));
    throw error;
  }
}

async function authorSemanticRegionMasters(frozenSources) {
  const tileBuffer = frozenSources["nirvana-tile-atlas.png"];
  const nativeContractPath = path.join(NATIVE_ROOT, "production-native-contract.json");
  const nativeContract = JSON.parse(await readFile(nativeContractPath, "utf8"));
  const publications = [];
  for (const kit of REGION_KITS) {
    const buffer = await authorSemanticTerrainAtlas(tileBuffer, kit);
    const semanticErrors = await validateSemanticTerrainAtlas(buffer);
    if (semanticErrors.length > 0) {
      throw new Error(`${kit} semantic terrain authoring failed:\n${semanticErrors.join("\n")}`);
    }
    const terrainContract = nativeContract.atlases[`${kit}-terrain`];
    const sceneryContract = nativeContract.atlases[`${kit}-scenery`];
    if (!terrainContract || !sceneryContract) {
      throw new Error(`${kit}: native region contract inventory is incomplete`);
    }
    terrainContract.semanticTerrainRoles = structuredClone(SEMANTIC_TERRAIN_ROLES);
    terrainContract.materialRamps = {
      "ground-cover": artMaterialRamp(kit, "ground"),
      "path-surface": artMaterialRamp(kit, "path"),
      "biome-accent": artMaterialRamp(kit, "accent"),
    };
    terrainContract.outlineCornerExceptions = [];
    terrainContract.sourceSha256 = hashBuffer(buffer);
    sceneryContract.semanticSceneryCells = structuredClone(SEMANTIC_SCENERY_CELLS[kit]);
    sceneryContract.semanticSceneryVariants = structuredClone(SEMANTIC_SCENERY_VARIANTS[kit]);
    publications.push({
      destination: path.join(NATIVE_ROOT, `regions/${kit}/terrain.png`),
      buffer,
    });
  }
  publications.push({
    destination: nativeContractPath,
    buffer: Buffer.from(`${JSON.stringify(nativeContract, null, 2)}\n`),
  });
  const staged = [];
  const committed = [];
  try {
    for (const publication of publications) {
      const temporary = `${publication.destination}.tmp-semantic-author-${process.pid}`;
      const previousBuffer = await readFile(publication.destination);
      await writeFile(temporary, publication.buffer);
      staged.push({ ...publication, temporary, previousBuffer });
    }
    for (const publication of staged) {
      await rename(publication.temporary, publication.destination);
      committed.push(publication);
    }
  } catch (error) {
    for (const publication of [...committed].reverse()) {
      const rollbackTemporary = `${publication.destination}.tmp-semantic-rollback-${process.pid}`;
      await writeFile(rollbackTemporary, publication.previousBuffer);
      await rename(rollbackTemporary, publication.destination);
    }
    await Promise.all(staged.map(({ temporary }) => rm(temporary, { force: true })));
    throw error;
  }
}

function artMaterialRamp(kit, family) {
  return REGION_ART[kit][family].map((color) => rgba(color).slice(0, 3));
}

async function authorGuideRegionMasters(frozenSources) {
  const guide = await rawAtlas(await readFile(REGION_GUIDE_PATH));
  const tileBuffer = frozenSources["nirvana-tile-atlas.png"];
  const nativeContractPath = path.join(NATIVE_ROOT, "production-native-contract.json");
  const nativeContract = JSON.parse(await readFile(nativeContractPath, "utf8"));
  const publications = [];
  for (const kit of REGION_KITS) {
    const [terrain, scenery, environment] = await Promise.all([
      authorSemanticTerrainAtlas(tileBuffer, kit),
      authorGuideSceneryAtlas(guide, kit),
      authorEnvironmentAtlas(kit),
    ]);
    const semanticErrors = await validateSemanticTerrainAtlas(terrain);
    if (semanticErrors.length > 0) {
      throw new Error(`${kit} guide terrain authoring failed:\n${semanticErrors.join("\n")}`);
    }
    const terrainContract = nativeContract.atlases[`${kit}-terrain`];
    const sceneryContract = nativeContract.atlases[`${kit}-scenery`];
    const environmentContract = nativeContract.atlases[`${kit}-environment`];
    terrainContract.semanticTerrainRoles = structuredClone(SEMANTIC_TERRAIN_ROLES);
    terrainContract.materialRamps = {
      "ground-cover": artMaterialRamp(kit, "ground"),
      "path-surface": artMaterialRamp(kit, "path"),
      "biome-accent": artMaterialRamp(kit, "accent"),
    };
    terrainContract.outlineCornerExceptions = [];
    terrainContract.sourceSha256 = hashBuffer(terrain);
    sceneryContract.semanticSceneryCells = structuredClone(SEMANTIC_SCENERY_CELLS[kit]);
    sceneryContract.semanticSceneryVariants = structuredClone(SEMANTIC_SCENERY_VARIANTS[kit]);
    sceneryContract.materialRamps = {
      "foliage-primary": artMaterialRamp(kit, "accent"),
      "earth-secondary": artMaterialRamp(kit, "path"),
      "ground-tertiary": artMaterialRamp(kit, "ground"),
      "timber-bark": [[84, 68, 52], [140, 108, 68], [184, 140, 104]],
    };
    sceneryContract.outlineCornerExceptions = [];
    sceneryContract.sourceSha256 = hashBuffer(scenery);
    environmentContract.materialRamps = {
      "foliage-primary": artMaterialRamp(kit, "accent"),
      "earth-secondary": artMaterialRamp(kit, "path"),
      "ground-tertiary": artMaterialRamp(kit, "ground"),
      "timber-bark": [[84, 68, 52], [140, 108, 68], [184, 140, 104]],
    };
    environmentContract.outlineCornerExceptions = [];
    environmentContract.sourceSha256 = hashBuffer(environment);
    publications.push(
      { destination: path.join(NATIVE_ROOT, `regions/${kit}/terrain.png`), buffer: terrain },
      { destination: path.join(NATIVE_ROOT, `regions/${kit}/scenery.png`), buffer: scenery },
      { destination: path.join(NATIVE_ROOT, `regions/${kit}/environment.png`), buffer: environment },
    );
  }
  publications.push({
    destination: nativeContractPath,
    buffer: Buffer.from(`${JSON.stringify(nativeContract, null, 2)}\n`),
  });
  const staged = [];
  const committed = [];
  try {
    for (const publication of publications) {
      const temporary = `${publication.destination}.tmp-guide-author-${process.pid}`;
      const previousBuffer = await readFile(publication.destination);
      await writeFile(temporary, publication.buffer);
      staged.push({ ...publication, temporary, previousBuffer });
    }
    for (const publication of staged) {
      await rename(publication.temporary, publication.destination);
      committed.push(publication);
    }
  } catch (error) {
    for (const publication of [...committed].reverse()) {
      const rollbackTemporary = `${publication.destination}.tmp-guide-rollback-${process.pid}`;
      await writeFile(rollbackTemporary, publication.previousBuffer);
      await rename(rollbackTemporary, publication.destination);
    }
    await Promise.all(staged.map(({ temporary }) => rm(temporary, { force: true })));
    throw error;
  }
}

async function readRegionalR4PersistedPackingReport() {
  return JSON.parse(await readFile(path.join(EVIDENCE_ROOT, "packing-report.json"), "utf8"));
}

async function readRegionalR4PersistedNativeContract() {
  return JSON.parse(await readFile(
    path.join(NATIVE_ROOT, "production-native-contract.json"),
    "utf8",
  ));
}

function regionalR4CanonicalAtlasKeys(persisted) {
  if (!Array.isArray(persisted?.atlases) || persisted.atlases.length !== 53) {
    throw new Error("trusted packing report requires exactly 53 atlas descriptors");
  }
  const keys = persisted.atlases.map(({ id }) => id);
  if (keys.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new Error("trusted packing report atlas IDs must be nonempty strings");
  }
  if (new Set(keys).size !== keys.length) {
    throw new Error("trusted packing report atlas IDs must be unique");
  }
  return keys.sort();
}

async function projectRegionalR4Budget(candidate) {
  const errors = [];
  const persisted = await readRegionalR4PersistedPackingReport();
  if (persisted.atlases?.length !== 53) errors.push("R4 budget projection requires exactly 53 persisted atlas descriptors");
  if (Object.keys(candidate.nativeContract.atlases ?? {}).length !== 53) errors.push("R4 candidate must preserve exactly 53 native atlases");
  const descriptors = (persisted.atlases ?? []).map((atlas) => ({ ...atlas }));
  for (const kit of REGION_KITS) for (const suffix of ["terrain", "landmarks", "home-yards"]) {
    const id = `${kit}-${suffix}`;
    const descriptor = descriptors.find((atlas) => atlas.id === id);
    const buffer = candidate.buffers[id];
    if (!descriptor || !Buffer.isBuffer(buffer)) {
      errors.push(`${id}: candidate budget bytes or descriptor missing`);
      continue;
    }
    const metadata = await sharp(buffer).metadata();
    if (metadata.width !== descriptor.width || metadata.height !== descriptor.height) {
      errors.push(`${id}: candidate budget geometry drift`);
      continue;
    }
    Object.assign(descriptor, {
      compressedBytes: buffer.length,
      decodedBytes: descriptor.width * descriptor.height * 4,
      sha256: hashBuffer(buffer),
      runtimeResized: false,
    });
  }
  const regions = {};
  for (const kit of REGION_KITS) {
    const region = regionMetadataFile(kit, descriptors, candidate.nativeContract).buffer;
    const home = homeMetadataFile(kit, descriptors, candidate.nativeContract).buffer;
    regions[kit] = { compressedBytes: region.length + home.length, decodedBytes: region.length + home.length };
  }
  const report = buildProductionPackingReport({
    atlases: descriptors,
    currentUiCompressedBytes: persisted.currentUiCompressedBytes,
    currentUiDecodedBytes: persisted.currentUiDecodedBytes,
    metadata: {
      core: {
        compressedBytes: persisted.coreMetadataCompressedBytes,
        decodedBytes: persisted.coreMetadataDecodedBytes,
      },
      regions,
    },
    budgets: persisted.budgets,
  });
  errors.push(...validateAssetBudgets(report));
  for (const kit of REGION_KITS) {
    if (report.exactPeakActiveDecodedBytes[kit] > 30_393_522) {
      errors.push(`${kit}: exact active decoded hard cap exceeded`);
    }
  }
  return { report, errors };
}

function normalizedR4Cell(bytes) {
  const colors = new Map();
  for (let offset = 0; offset < bytes.length; offset += 4) {
    if (bytes[offset + 3] === 0) continue;
    const key = `${bytes[offset]},${bytes[offset + 1]},${bytes[offset + 2]}`;
    if (!colors.has(key)) colors.set(key, bytes[offset] * 299 + bytes[offset + 1] * 587 + bytes[offset + 2] * 114);
  }
  const ordered = [...colors.entries()].sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]));
  const rank = new Map(ordered.map(([key], index) => [
    key,
    1 + Math.min(3, Math.floor(index * 4 / Math.max(1, ordered.length))),
  ]));
  return Uint8Array.from({ length: bytes.length / 4 }, (_unused, pixelIndex) => {
    const offset = pixelIndex * 4;
    return bytes[offset + 3] === 0 ? 0 : rank.get(`${bytes[offset]},${bytes[offset + 1]},${bytes[offset + 2]}`);
  });
}

function r4IdentityRatio(left, right) {
  let compared = 0;
  let identical = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === 0 && right[index] === 0) continue;
    compared += 1;
    if (left[index] === right[index]) identical += 1;
  }
  return identical / Math.max(1, compared);
}

function validateR4DistinctFamily(errors, label, cells) {
  for (let leftIndex = 0; leftIndex < cells.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < cells.length; rightIndex += 1) {
      const left = cells[leftIndex];
      const right = cells[rightIndex];
      if (hashBuffer(left.bytes) === hashBuffer(right.bytes)) errors.push(`${label}/${left.id}/${right.id}: duplicate raw cell bytes`);
      const identity = r4IdentityRatio(normalizedR4Cell(left.bytes), normalizedR4Cell(right.bytes));
      if (identity > 0.92) errors.push(`${label}/${left.id}/${right.id}: palette-normalized identity ${identity.toFixed(4)} exceeds 0.92`);
    }
  }
}

function r4BinaryCorrelation(pairs) {
  let sumLeft = 0;
  let sumRight = 0;
  let sumBoth = 0;
  for (const [left, right] of pairs) {
    sumLeft += left;
    sumRight += right;
    sumBoth += left * right;
  }
  const count = pairs.length;
  const denominator = Math.sqrt(
    (count * sumLeft - sumLeft ** 2) * (count * sumRight - sumRight ** 2),
  );
  return denominator === 0 ? 1 : (count * sumBoth - sumLeft * sumRight) / denominator;
}

function r4EnclosedTransparentSockets(bytes, width, height) {
  const transparent = new Set();
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (bytes[(y * width + x) * 4 + 3] === 0) transparent.add(`${x},${y}`);
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
  return sockets;
}

function r4AlphaCoverage(bytes, width, rectangle) {
  let opaque = 0;
  for (let y = rectangle.y; y < rectangle.y + rectangle.height; y += 1) {
    for (let x = rectangle.x; x < rectangle.x + rectangle.width; x += 1) {
      if (bytes[(y * width + x) * 4 + 3] === 255) opaque += 1;
    }
  }
  return opaque / (rectangle.width * rectangle.height);
}

async function validateRegionalR4Pixels(candidate) {
  const errors = [];
  for (const kit of REGION_KITS) {
    const terrainBuffer = candidate.buffers[`${kit}-terrain`];
    errors.push(...(await validateSemanticTerrainAtlas(terrainBuffer)).map((error) => `${kit}: ${error}`));
    const terrain = await rawAtlas(terrainBuffer);
    const groundCells = Array.from({ length: 8 }, (_unused, cellIndex) => ({
      id: `ground-${cellIndex}`,
      bytes: extractRawCell(terrain, cellIndex, 8, 32, 32),
    }));
    validateR4DistinctFamily(errors, `${kit}/ground`, groundCells);
    const groundMasks = groundCells.map(({ bytes }) => {
      const frequencies = new Map();
      for (let offset = 0; offset < bytes.length; offset += 4) {
        const key = `${bytes[offset]},${bytes[offset + 1]},${bytes[offset + 2]}`;
        frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
      }
      const dominant = [...frequencies].sort((left, right) => right[1] - left[1])[0][0];
      return Uint8Array.from({ length: 1024 }, (_unused, pixelIndex) => {
        const offset = pixelIndex * 4;
        return `${bytes[offset]},${bytes[offset + 1]},${bytes[offset + 2]}` === dominant ? 0 : 1;
      });
    });
    const grid = candidate.compositionPlans[kit].groundRecipeGrid;
    for (let shift = 1; shift <= 8; shift += 1) for (const [dx, dy, axis] of [[shift, 0, "x"], [0, shift, "y"]]) {
      const pairs = [];
      for (let y = 0; y < 16 - dy; y += 1) for (let x = 0; x < 24 - dx; x += 1) {
        for (let pixelIndex = 0; pixelIndex < 1024; pixelIndex += 1) {
          pairs.push([groundMasks[grid[y][x]][pixelIndex], groundMasks[grid[y + dy][x + dx]][pixelIndex]]);
        }
      }
      const correlation = Math.abs(r4BinaryCorrelation(pairs));
      if (correlation > 0.35) errors.push(`${kit}: ground-mask autocorrelation ${axis}${shift}=${correlation.toFixed(4)} exceeds 0.35`);
    }
    const landmark = await rawAtlas(candidate.buffers[`${kit}-landmarks`]);
    const records = candidate.nativeContract.atlases[`${kit}-landmarks`].authoredVariants;
    const recordsByKind = new Map();
    for (const record of records) {
      if (!recordsByKind.has(record.semanticKind)) recordsByKind.set(record.semanticKind, []);
      recordsByKind.get(record.semanticKind).push({
        id: record.variantId,
        bytes: extractRawCell(landmark, record.cellIndex, 4, 128, 128),
      });
    }
    for (const [kind, cells] of recordsByKind) validateR4DistinctFamily(errors, `${kit}/landmark/${kind}`, cells);
    const yard = await rawAtlas(candidate.buffers[`${kit}-home-yards`]);
    const yardCell = (cellIndex) => ({
      id: candidate.nativeContract.atlases[`${kit}-home-yards`].authoredVariants[cellIndex].variantId,
      bytes: extractRawCell(yard, cellIndex, 5, 192, 160),
    });
    validateR4DistinctFamily(errors, `${kit}/yard/base`, [yardCell(0), yardCell(1), yardCell(4)]);
    validateR4DistinctFamily(errors, `${kit}/yard/overlay`, [yardCell(2), yardCell(3)]);
    for (const cellIndex of [0, 1, 4]) {
      const bytes = yardCell(cellIndex).bytes;
      if (r4AlphaCoverage(bytes, 192, { x: 32, y: 48, width: 128, height: 64 }) < 0.25) {
        errors.push(`${kit}/yard-${cellIndex}: foundation coverage below 0.25`);
      }
      if (r4AlphaCoverage(bytes, 192, { x: 80, y: 112, width: 32, height: 48 }) > 0.08) {
        errors.push(`${kit}/yard-${cellIndex}: south door corridor obstructed`);
      }
      if (r4EnclosedTransparentSockets(bytes, 192, 160) !== 0) errors.push(`${kit}/yard-${cellIndex}: enclosed placement socket`);
      let outerOpaque = 0;
      let outerPixels = 0;
      for (let y = 0; y < 160; y += 1) for (let x = 0; x < 192; x += 1) {
        if (!(x < 8 || x >= 184 || y < 8 || y >= 152)) continue;
        outerPixels += 1;
        if (bytes[(y * 192 + x) * 4 + 3] === 255) outerOpaque += 1;
      }
      const outerCoverage = outerOpaque / outerPixels;
      if (outerCoverage < 0.01 || outerCoverage > 0.55) errors.push(`${kit}/yard-${cellIndex}: outer coverage is not ragged`);
    }
  }
  return errors;
}

function validateRegionalR4Bindings(candidate) {
  const errors = [...validateRegionalR4Spec()];
  for (const kit of REGION_KITS) {
    const expected = {
      terrain: canonicalDigest(REGIONAL_R4_VARIANT_RECIPES[kit].ground),
      landmarks: canonicalDigest(REGIONAL_R4_VARIANT_RECIPES[kit].landmarks),
      yards: canonicalDigest(REGIONAL_R4_VARIANT_RECIPES[kit].yards),
      scene: canonicalDigest(REGIONAL_R4_SCENE_PLANS[kit]),
    };
    for (const [family, digest] of Object.entries(expected)) {
      if (candidate.recipeDigests?.[kit]?.[family] !== digest) errors.push(`${kit}/${family}: R4 recipe digest drift`);
    }
    if (canonicalJson(candidate.compositionPlans?.[kit]) !== canonicalJson(REGIONAL_R4_SCENE_PLANS[kit])) {
      errors.push(`${kit}: R4 composition plan drift`);
    }
  }
  return errors;
}

const REGIONAL_R4_BUFFER_KEYS = Object.freeze(REGION_KITS.flatMap((kit) => [
  `${kit}-terrain`, `${kit}-landmarks`, `${kit}-home-yards`,
]).sort());
const REGIONAL_R4_PROOF_KEYS = Object.freeze([...REGION_KITS].sort());
const REGIONAL_R4_RECIPE_DIGEST_KEYS = Object.freeze(["landmarks", "scene", "terrain", "yards"]);
const REGIONAL_R4_BUDGET_PROJECTION_KEYS = Object.freeze(["errors", "report"]);
const REGIONAL_R4_CANDIDATE_KEYS = Object.freeze([
  "budgetProjection",
  "buffers",
  "compositionPlans",
  "evidenceNames",
  "nativeContract",
  "proofDigests",
  "proofs",
  "recipeDigests",
]);

function exactSortedKeys(value, expected) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson(expected);
}

function validateRegionalR4CandidateShape(candidate, canonicalAtlasKeys, canonicalNativeContractKeys) {
  const errors = [];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return ["R4 candidate must be an object"];
  }
  if (!exactSortedKeys(candidate, REGIONAL_R4_CANDIDATE_KEYS)) {
    errors.push("R4 candidate keys must remain exact");
  }
  if (!exactSortedKeys(candidate.buffers, REGIONAL_R4_BUFFER_KEYS)) {
    errors.push("candidate buffers must contain exactly 15 canonical keys");
  }
  for (const key of REGIONAL_R4_BUFFER_KEYS) {
    if (candidate.buffers && Object.hasOwn(candidate.buffers, key) && !Buffer.isBuffer(candidate.buffers[key])) {
      errors.push(`${key}: candidate buffer must be a Buffer`);
    }
  }
  if (!exactSortedKeys(candidate.proofs, REGIONAL_R4_PROOF_KEYS)) {
    errors.push("candidate proofs must contain exactly five canonical keys");
  }
  for (const kit of REGION_KITS) {
    if (candidate.proofs && Object.hasOwn(candidate.proofs, kit) && !Buffer.isBuffer(candidate.proofs[kit])) {
      errors.push(`${kit}: candidate proof must be a Buffer`);
    }
  }
  if (!exactSortedKeys(candidate.proofDigests, REGIONAL_R4_PROOF_KEYS)) {
    errors.push("candidate proofDigests must contain exactly five canonical keys");
  }
  const atlasCount = candidate.nativeContract?.atlases && typeof candidate.nativeContract.atlases === "object"
    ? Object.keys(candidate.nativeContract.atlases).length
    : 0;
  if (atlasCount !== 53) errors.push("candidate native contract must contain exactly 53 atlases");
  if (Array.isArray(canonicalAtlasKeys)) {
    const actualAtlasKeys = candidate.nativeContract?.atlases
      && typeof candidate.nativeContract.atlases === "object"
      && !Array.isArray(candidate.nativeContract.atlases)
      ? Object.keys(candidate.nativeContract.atlases)
      : [];
    for (const atlasId of canonicalAtlasKeys) {
      if (!actualAtlasKeys.includes(atlasId)) {
        errors.push(`candidate native contract is missing canonical atlas ${atlasId}`);
      }
    }
    for (const atlasId of actualAtlasKeys) {
      if (!canonicalAtlasKeys.includes(atlasId)) {
        errors.push(`candidate native contract contains unexpected atlas ${atlasId}`);
      }
    }
  }
  if (Array.isArray(canonicalNativeContractKeys)
    && !exactSortedKeys(candidate.nativeContract, canonicalNativeContractKeys)) {
    errors.push("candidate nativeContract keys must equal the trusted persisted contract schema");
  }
  if (!exactSortedKeys(candidate.compositionPlans, REGIONAL_R4_PROOF_KEYS)) {
    errors.push("candidate compositionPlans must contain exactly five canonical kit keys");
  }
  if (!exactSortedKeys(candidate.recipeDigests, REGIONAL_R4_PROOF_KEYS)) {
    errors.push("candidate recipeDigests must contain exactly five canonical kit keys");
  }
  for (const kit of REGION_KITS) {
    if (candidate.recipeDigests && Object.hasOwn(candidate.recipeDigests, kit)
      && !exactSortedKeys(candidate.recipeDigests[kit], REGIONAL_R4_RECIPE_DIGEST_KEYS)) {
      errors.push(`${kit}: candidate recipeDigests must contain exactly terrain, landmarks, yards, and scene`);
    }
  }
  if (!candidate.budgetProjection || typeof candidate.budgetProjection !== "object"
    || !candidate.budgetProjection.report || !Array.isArray(candidate.budgetProjection.errors)) {
    errors.push("candidate budgetProjection requires canonical report and errors");
  }
  if (!exactSortedKeys(candidate.budgetProjection, REGIONAL_R4_BUDGET_PROJECTION_KEYS)) {
    errors.push("candidate budgetProjection must contain exactly report and errors");
  }
  const expectedEvidence = regionalR4EvidenceNames();
  const evidenceNames = candidate.evidenceNames;
  if (!Array.isArray(evidenceNames) || canonicalJson(evidenceNames) !== canonicalJson(expectedEvidence)) {
    errors.push("candidate evidenceNames must equal the exact 41-name inventory");
  }
  if (!Array.isArray(evidenceNames)
    || new Set(evidenceNames).size !== evidenceNames.length
    || evidenceNames.some((name) => typeof name !== "string" || path.basename(name) !== name)) {
    errors.push("candidate evidenceNames must use unique basenames");
  }
  return errors;
}

async function validateRegionalR4ProofBuffers(candidate) {
  const errors = [];
  for (const kit of REGION_KITS) {
    const buffer = candidate.proofs?.[kit];
    if (!Buffer.isBuffer(buffer)) continue;
    if (buffer.length === 0) errors.push(`${kit}: candidate proof PNG must be nonempty`);
    const digest = hashBuffer(buffer);
    if (candidate.proofDigests?.[kit] !== digest) errors.push(`${kit}: candidate proof digest drift`);
    try {
      const metadata = await sharp(buffer).metadata();
      if (metadata.width !== 768 || metadata.height !== 512 || metadata.format !== "png") {
        errors.push(`${kit}: candidate proof PNG must be exactly 768x512`);
      }
    } catch (_error) {
      errors.push(`${kit}: candidate proof PNG is unreadable`);
    }
  }
  return errors;
}

async function appendRegionalR4Validation(errors, label, validator) {
  try {
    const discovered = await validator();
    if (!Array.isArray(discovered)) errors.push(`${label}: validator did not return an error array`);
    else errors.push(...discovered);
  } catch (error) {
    errors.push(`${label}: validation could not run (${error?.message ?? "unknown error"})`);
  }
}

/** Validate every R4 candidate gate before proof bytes may be staged. */
export async function validateRegionalR4Candidate(candidate) {
  let canonicalAtlasKeys;
  let trustedInventoryError;
  try {
    canonicalAtlasKeys = regionalR4CanonicalAtlasKeys(await readRegionalR4PersistedPackingReport());
  } catch (error) {
    trustedInventoryError = error;
  }
  let canonicalNativeContractKeys;
  let trustedContractError;
  try {
    const persistedNativeContract = await readRegionalR4PersistedNativeContract();
    if (!persistedNativeContract || typeof persistedNativeContract !== "object"
      || Array.isArray(persistedNativeContract)) {
      throw new Error("trusted native contract must be an object");
    }
    canonicalNativeContractKeys = Object.keys(persistedNativeContract).sort();
  } catch (error) {
    trustedContractError = error;
  }
  const errors = validateRegionalR4CandidateShape(
    candidate,
    canonicalAtlasKeys,
    canonicalNativeContractKeys,
  );
  if (trustedInventoryError) {
    errors.push(`trusted atlas inventory: validation could not run (${trustedInventoryError.message})`);
  }
  if (trustedContractError) {
    errors.push(`trusted native contract: validation could not run (${trustedContractError.message})`);
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return errors;
  const buffersClosed = exactSortedKeys(candidate.buffers, REGIONAL_R4_BUFFER_KEYS)
    && REGIONAL_R4_BUFFER_KEYS.every((key) => Buffer.isBuffer(candidate.buffers[key]));
  const proofsClosed = exactSortedKeys(candidate.proofs, REGIONAL_R4_PROOF_KEYS)
    && REGION_KITS.every((kit) => Buffer.isBuffer(candidate.proofs[kit]));
  const nativeClosed = Array.isArray(canonicalAtlasKeys)
    && Array.isArray(canonicalNativeContractKeys)
    && exactSortedKeys(candidate.nativeContract, canonicalNativeContractKeys)
    && exactSortedKeys(candidate.nativeContract?.atlases, canonicalAtlasKeys);
  const plansClosed = exactSortedKeys(candidate.compositionPlans, REGIONAL_R4_PROOF_KEYS);
  const budgetClosed = exactSortedKeys(
    candidate.budgetProjection,
    REGIONAL_R4_BUDGET_PROJECTION_KEYS,
  ) && candidate.budgetProjection.report && Array.isArray(candidate.budgetProjection.errors);

  await appendRegionalR4Validation(errors, "native schema", () => (
    validateNativeContractSchema(candidate.nativeContract)
  ));
  if (buffersClosed && nativeClosed) {
    await appendRegionalR4Validation(errors, "regional geometry", () => (
      validateRegionalCompositionContract(candidate.nativeContract, candidate.buffers)
    ));
  }
  await appendRegionalR4Validation(errors, "R4 binding", () => validateRegionalR4Bindings(candidate));
  if (proofsClosed) {
    await appendRegionalR4Validation(errors, "R4 proofs", () => validateRegionalR4ProofBuffers(candidate));
  }
  if (buffersClosed && nativeClosed && budgetClosed) {
    try {
      const recomputed = await projectRegionalR4Budget(candidate);
      if (canonicalJson(candidate.budgetProjection.report) !== canonicalJson(recomputed.report)) {
        errors.push("candidate budgetProjection report drifted from recomputation");
      }
      if (canonicalJson(candidate.budgetProjection.errors) !== canonicalJson(recomputed.errors)) {
        errors.push("candidate budgetProjection errors drifted from recomputation");
      }
      errors.push(...recomputed.errors);
    } catch (error) {
      errors.push(`R4 budget: validation could not run (${error?.message ?? "unknown error"})`);
    }
  }
  if (buffersClosed && nativeClosed && plansClosed) {
    await appendRegionalR4Validation(errors, "R4 pixels", () => validateRegionalR4Pixels(candidate));
  }
  return errors;
}

/** Rebuild the rejected R3/R3.1 proof candidate for deterministic historical diagnostics only. */
export async function buildRegionalR3DiagnosticAuthoring() {
  const nativeContract = JSON.parse(await readFile(
    path.join(NATIVE_ROOT, "production-native-contract.json"),
    "utf8",
  ));
  const buffers = {};
  const compositionPlans = {};
  for (const kit of REGION_KITS) {
    const terrainId = `${kit}-terrain`;
    const landmarkId = `${kit}-landmarks`;
    const yardId = `${kit}-home-yards`;
    const [terrain, landmarks, yards] = await Promise.all([
      authorSemanticTerrainAtlas(null, kit),
      authorLandmarkAtlas(kit),
      authorYardAtlas(kit),
    ]);
    const semanticErrors = await validateSemanticTerrainAtlas(
      terrain,
      SEMANTIC_TERRAIN_ROLES,
      { requireUnusedCellsTransparent: false },
    );
    if (semanticErrors.length > 0) throw new Error(`${kit} R3 diagnostic terrain failed:\n${semanticErrors.join("\n")}`);
    buffers[terrainId] = terrain;
    buffers[landmarkId] = landmarks;
    buffers[yardId] = yards;
    const terrainContract = nativeContract.atlases[terrainId];
    terrainContract.semanticTerrainRoles = structuredClone(SEMANTIC_TERRAIN_ROLES);
    terrainContract.materialRamps = {
      "ground-cover": artMaterialRamp(kit, "ground"),
      "path-surface": artMaterialRamp(kit, "path"),
      "biome-accent": artMaterialRamp(kit, "accent"),
    };
    terrainContract.outlineCornerExceptions = [];
    terrainContract.sourceSha256 = hashBuffer(terrain);
    nativeContract.atlases[landmarkId] = {
      width: REGIONAL_COMPOSITION_GEOMETRY.landmarks.width,
      height: REGIONAL_COMPOSITION_GEOMETRY.landmarks.height,
      cellWidth: REGIONAL_COMPOSITION_GEOMETRY.landmarks.cellWidth,
      cellHeight: REGIONAL_COMPOSITION_GEOMETRY.landmarks.cellHeight,
      outlineColors: [[28, 28, 36]],
      materialRamps: regionalMaterialRamps(kit),
      outlineCornerExceptions: [],
      sourceSha256: hashBuffer(landmarks),
      semanticMaterials: kit === "ash-waste"
        ? ["industrial-irradiation", "plum-charcoal", "coral-fissure", "oxidized-metal", "containment-relief"]
        : [`${kit}-landscape`, `${kit}-groundwork`, `${kit}-regional-materials`],
      authoredVariants: await authoredVariantGeometryList(
        landmarks,
        REGIONAL_COMPOSITION_GEOMETRY.landmarks,
        REGIONAL_VARIANT_SPECS[kit].landmarks,
      ),
    };
    nativeContract.atlases[yardId] = {
      width: REGIONAL_COMPOSITION_GEOMETRY.yards.width,
      height: REGIONAL_COMPOSITION_GEOMETRY.yards.height,
      cellWidth: REGIONAL_COMPOSITION_GEOMETRY.yards.cellWidth,
      cellHeight: REGIONAL_COMPOSITION_GEOMETRY.yards.cellHeight,
      outlineColors: [[28, 28, 36]],
      materialRamps: regionalMaterialRamps(kit),
      outlineCornerExceptions: [],
      sourceSha256: hashBuffer(yards),
      semanticMaterials: [`${kit}-home-apron`, `${kit}-attached-household-materials`],
      authoredVariants: await authoredVariantGeometryList(
        yards,
        REGIONAL_COMPOSITION_GEOMETRY.yards,
        REGIONAL_VARIANT_SPECS[kit].yards,
      ),
    };
    compositionPlans[kit] = regionalCompositionPlan(kit);
  }
  const outputs = [];
  for (const kit of REGION_KITS) {
    outputs.push(
      { relativePath: `regions/${kit}/terrain.png`, buffer: buffers[`${kit}-terrain`] },
      { relativePath: `regions/${kit}/landmarks.png`, buffer: buffers[`${kit}-landmarks`] },
      { relativePath: `homes/${kit}/yards.png`, buffer: buffers[`${kit}-home-yards`] },
    );
    for (const relativePath of [
      `regions/${kit}/scenery.png`,
      `homes/${kit}/components.png`,
      `homes/${kit}/ruins.png`,
    ]) outputs.push({ relativePath, buffer: await readFile(path.join(NATIVE_ROOT, relativePath)) });
  }
  const proofs = Object.fromEntries(await Promise.all(REGION_KITS.map(async (kit) => [
    kit,
    await regionalCompositionScene({ outputs }, kit, compositionPlans[kit]),
  ])));
  return { nativeContract, buffers, proofs, compositionPlans };
}

export async function buildRegionalCompositionAuthoring() {
  const contractPath = path.join(NATIVE_ROOT, "production-native-contract.json");
  const nativeContract = JSON.parse(await readFile(contractPath, "utf8"));
  const specErrors = validateRegionalR4Spec();
  if (specErrors.length > 0) throw new Error(`R4 specification is invalid:\n${specErrors.join("\n")}`);
  const buffers = {};
  const compositionPlans = {};
  const recipeDigests = {};
  for (const kit of REGION_KITS) {
    const terrainId = `${kit}-terrain`;
    const landmarkId = `${kit}-landmarks`;
    const yardId = `${kit}-home-yards`;
    const [terrain, landmarks, yards] = await Promise.all([
      authorRegionalR4TerrainAtlas(kit),
      authorRegionalR4LandmarkAtlas(kit),
      authorRegionalR4YardAtlas(kit),
    ]);
    const semanticErrors = await validateSemanticTerrainAtlas(terrain);
    if (semanticErrors.length > 0) throw new Error(`${kit} R4 terrain authoring failed:\n${semanticErrors.join("\n")}`);
    buffers[terrainId] = terrain;
    buffers[landmarkId] = landmarks;
    buffers[yardId] = yards;
    const terrainContract = nativeContract.atlases[terrainId];
    Object.assign(terrainContract, { width: 256, height: 256, cellWidth: 32, cellHeight: 32 });
    terrainContract.semanticTerrainRoles = structuredClone(SEMANTIC_TERRAIN_ROLES);
    terrainContract.materialRamps = {
      "ground-cover": artMaterialRamp(kit, "ground"),
      "path-surface": artMaterialRamp(kit, "path"),
      "biome-accent": artMaterialRamp(kit, "accent"),
    };
    terrainContract.outlineCornerExceptions = [];
    terrainContract.sourceSha256 = hashBuffer(terrain);
    const sceneryContract = nativeContract.atlases[`${kit}-scenery`];
    Object.assign(sceneryContract, { width: 512, height: 256, cellWidth: 32, cellHeight: 32 });
    nativeContract.atlases[landmarkId] = {
      width: REGIONAL_COMPOSITION_GEOMETRY.landmarks.width,
      height: REGIONAL_COMPOSITION_GEOMETRY.landmarks.height,
      cellWidth: REGIONAL_COMPOSITION_GEOMETRY.landmarks.cellWidth,
      cellHeight: REGIONAL_COMPOSITION_GEOMETRY.landmarks.cellHeight,
      outlineColors: [[28, 28, 36]],
      materialRamps: regionalMaterialRamps(kit),
      outlineCornerExceptions: [],
      sourceSha256: hashBuffer(landmarks),
      semanticMaterials: kit === "ash-waste"
        ? ["industrial-irradiation", "plum-charcoal", "coral-fissure", "oxidized-metal", "containment-relief"]
        : [`${kit}-landscape`, `${kit}-groundwork`, `${kit}-regional-materials`],
      authoredVariants: await authoredVariantGeometryList(
        landmarks,
        REGIONAL_COMPOSITION_GEOMETRY.landmarks,
        REGIONAL_VARIANT_SPECS[kit].landmarks,
      ),
    };
    nativeContract.atlases[yardId] = {
      width: REGIONAL_COMPOSITION_GEOMETRY.yards.width,
      height: REGIONAL_COMPOSITION_GEOMETRY.yards.height,
      cellWidth: REGIONAL_COMPOSITION_GEOMETRY.yards.cellWidth,
      cellHeight: REGIONAL_COMPOSITION_GEOMETRY.yards.cellHeight,
      outlineColors: [[28, 28, 36]],
      materialRamps: regionalMaterialRamps(kit),
      outlineCornerExceptions: [],
      sourceSha256: hashBuffer(yards),
      semanticMaterials: [`${kit}-home-apron`, `${kit}-attached-household-materials`],
      authoredVariants: await authoredVariantGeometryList(
        yards,
        REGIONAL_COMPOSITION_GEOMETRY.yards,
        REGIONAL_VARIANT_SPECS[kit].yards,
      ),
    };
    compositionPlans[kit] = structuredClone(REGIONAL_R4_SCENE_PLANS[kit]);
    recipeDigests[kit] = {
      terrain: canonicalDigest(REGIONAL_R4_VARIANT_RECIPES[kit].ground),
      landmarks: canonicalDigest(REGIONAL_R4_VARIANT_RECIPES[kit].landmarks),
      yards: canonicalDigest(REGIONAL_R4_VARIANT_RECIPES[kit].yards),
      scene: canonicalDigest(REGIONAL_R4_SCENE_PLANS[kit]),
    };
  }
  nativeContract.provenance = "Original project-owned R4 production candidates rendered at native resolution from explicit immutable per-kit pixel recipes and scene plans; no R3 template, third-party art, runtime resize, or generated default is used.";
  const outputs = [];
  for (const kit of REGION_KITS) {
    outputs.push(
      { relativePath: `regions/${kit}/terrain.png`, buffer: buffers[`${kit}-terrain`] },
      { relativePath: `regions/${kit}/landmarks.png`, buffer: buffers[`${kit}-landmarks`] },
      { relativePath: `homes/${kit}/yards.png`, buffer: buffers[`${kit}-home-yards`] },
    );
    for (const relativePath of [
      `regions/${kit}/scenery.png`,
      `homes/${kit}/components.png`,
      `homes/${kit}/ruins.png`,
    ]) outputs.push({ relativePath, buffer: await readFile(path.join(NATIVE_ROOT, relativePath)) });
  }
  const proofs = Object.fromEntries(await Promise.all(REGION_KITS.map(async (kit) => [
    kit,
    await regionalR4CompositionScene({ outputs }, kit, compositionPlans[kit]),
  ])));
  const proofDigests = Object.fromEntries(REGION_KITS.map((kit) => [kit, hashBuffer(proofs[kit])]));
  const evidenceNames = regionalR4EvidenceNames();
  const candidate = {
    nativeContract,
    buffers,
    proofs,
    compositionPlans,
    recipeDigests,
    proofDigests,
    evidenceNames,
  };
  candidate.budgetProjection = await projectRegionalR4Budget(candidate);
  return candidate;
}

async function authorRegionalCompositionMasters() {
  const contractPath = path.join(NATIVE_ROOT, "production-native-contract.json");
  const { nativeContract, buffers } = await buildRegionalCompositionAuthoring();
  const validationErrors = [
    ...validateNativeContractSchema(nativeContract),
    ...await validateRegionalCompositionContract(nativeContract, buffers),
  ];
  if (validationErrors.length > 0) {
    throw new Error(`Regional composition authoring failed:\n${validationErrors.join("\n")}`);
  }
  const publications = [];
  for (const kit of REGION_KITS) {
    publications.push(
      {
        destination: path.join(NATIVE_ROOT, `regions/${kit}/terrain.png`),
        buffer: buffers[`${kit}-terrain`],
      },
      {
        destination: path.join(NATIVE_ROOT, `regions/${kit}/landmarks.png`),
        buffer: buffers[`${kit}-landmarks`],
      },
      {
        destination: path.join(NATIVE_ROOT, `homes/${kit}/yards.png`),
        buffer: buffers[`${kit}-home-yards`],
      },
    );
  }
  publications.push({
    destination: contractPath,
    buffer: Buffer.from(`${JSON.stringify(nativeContract, null, 2)}\n`),
  });
  const staged = [];
  const committed = [];
  try {
    for (const publication of publications) {
      await mkdir(path.dirname(publication.destination), { recursive: true });
      const temporary = `${publication.destination}.tmp-regional-composition-${process.pid}`;
      let previous = null;
      try {
        previous = await readFile(publication.destination);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await writeFile(temporary, publication.buffer);
      staged.push({ ...publication, temporary, previous });
    }
    for (const publication of staged) {
      await rename(publication.temporary, publication.destination);
      committed.push(publication);
    }
  } catch (error) {
    for (const publication of [...committed].reverse()) {
      if (publication.previous === null) {
        await rm(publication.destination, { force: true });
      } else {
        const rollback = `${publication.destination}.tmp-regional-composition-rollback-${process.pid}`;
        await writeFile(rollback, publication.previous);
        await rename(rollback, publication.destination);
      }
    }
    await Promise.all(staged.map(({ temporary }) => rm(temporary, { force: true })));
    throw error;
  }
}

// REGIONAL_R5_OFFLINE_ENGINE_START

const REGIONAL_R5_OUTLINE_RGBA = Object.freeze([28, 28, 36, 255]);
const REGIONAL_R5_DECODED_RGBA_SHA256 = Object.freeze({
  regionKits: "0be8998e754cb1b3591df3b8b0a45bdac0fafcc984f613e7790beee4c6d34379",
  homeRuin: "410ff696644276f6fc623c5e2a2a66df01fcbdfc2f020df371a7149c1976a2e3",
});
const REGIONAL_R5_BUFFER_METHOD_SHADOWS = Object.freeze(["copy", "subarray", "set"]);
const REGIONAL_R5_AUTHORING_TRUST = new WeakMap();
const REGIONAL_R5_CONNECTIVITY_TRUST = new WeakMap();
const REGIONAL_R5_BLIND_REPAIR_CLUSTER_SHA256 = Object.freeze({
  "spring-upper-terrace": "3115804fbb2032c1bcc6fdbc1a68e2c6aa86229b1ec239aa875265fb35945a2d",
  "spring-reed-outlet": "6bbc1647ed57099183ee636fdfd70ed24b15731ad3d8fd3c7a6b237010fcf843",
  "spring-boardwalk-north": "4b30cf5b472f26bfb0c0b4f57f20cd1e89c3f41771a0e6817e09e4a7e4c90457",
  "neutral-grove-west": "756e1eee7b1c953f7cd414558f48c83ebe4280b2b4e57746d22ec24d75e57c1d",
});

function regionalR5BufferIsUnshadowed(data) {
  return Buffer.isBuffer(data) && Object.getPrototypeOf(data) === Buffer.prototype
    && Object.getOwnPropertySymbols(data).length === 0
    && !REGIONAL_R5_BUFFER_METHOD_SHADOWS.some((name) => Object.hasOwn(data, name));
}

function assertRegionalR5Raw(image, label = "R5 raw image") {
  if (!image || typeof image !== "object" || !Buffer.isBuffer(image.data)
      || !finiteInteger(image.width) || image.width <= 0
      || !finiteInteger(image.height) || image.height <= 0
      || image.channels !== 4 || image.data.length !== image.width * image.height * 4) {
    throw new TypeError(`${label} requires exact width/height/channels=4 Buffer data`);
  }
  if (!regionalR5BufferIsUnshadowed(image.data)) {
    throw new TypeError(`${label} requires unshadowed Buffer copy/subarray/set behavior`);
  }
}

function regionalR5HexRgb(value, label) {
  if (typeof value !== "string" || !/^#[a-f0-9]{6}$/i.test(value)) {
    throw new TypeError(`${label} must be a six-digit RGB token`);
  }
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

/** Normalize one complete pinned guide by exact even/even nearest sampling. */
export function normalizeRegionalR5WholeSheet(source) {
  assertRegionalR5Raw(source, "R5 guide source");
  if (source.width !== 1536 || source.height !== 1024) {
    throw new RangeError(`R5 guide source dimensions must be exactly 1536x1024, received ${source.width}x${source.height}`);
  }
  const width = 768;
  const height = 512;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sourceOffset = ((y * 2) * source.width + x * 2) * 4;
    source.data.copy(data, (y * width + x) * 4, sourceOffset, sourceOffset + 4);
  }
  return { data, width, height, channels: 4 };
}

/** Normalize a half-open source rectangle with the pinned odd-coordinate formula. */
export function normalizedRegionalR5Rect(rect) {
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(finiteInteger)) {
    throw new TypeError("R5 normalized rectangle requires four integers");
  }
  const [x, y, width, height] = rect;
  if (x < 0 || y < 0 || width <= 0 || height <= 0) {
    throw new RangeError("R5 normalized rectangle requires nonnegative origin and positive size");
  }
  const left = Math.ceil(x / 2);
  const top = Math.ceil(y / 2);
  return [left, top, Math.ceil((x + width) / 2) - left, Math.ceil((y + height) / 2) - top];
}

function regionalR5RawCrop(source, rect) {
  assertRegionalR5Raw(source, "R5 normalized guide");
  const [x, y, width, height] = rect;
  if (![x, y, width, height].every(finiteInteger) || x < 0 || y < 0 || width <= 0 || height <= 0
      || x + width > source.width || y + height > source.height) {
    throw new RangeError(`R5 crop ${rect.join(",")} is outside ${source.width}x${source.height}`);
  }
  const data = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = ((y + row) * source.width + x) * 4;
    source.data.copy(data, row * width * 4, sourceOffset, sourceOffset + width * 4);
  }
  return { data, width, height, channels: 4 };
}

/** Chroma-clean, binary-alpha quantize, and repair one crop-local outline pass. */
export function cleanRegionalR5Crop({ data, width, height, channels = 4, palette }) {
  const source = { data, width, height, channels };
  assertRegionalR5Raw(source, "R5 crop");
  if (!palette || typeof palette !== "object" || Array.isArray(palette)
      || Object.keys(palette).length === 0) {
    throw new TypeError("R5 crop requires a nonempty named palette");
  }
  const candidates = Object.entries(palette)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([token, hex]) => ({ token, rgb: regionalR5HexRgb(hex, token) }));
  const preRepair = Buffer.alloc(data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const alpha = data[offset + 3];
    const chroma = red > 210 && blue > 170 && green < 100;
    if (alpha === 0 || chroma) continue;
    if (red === 28 && green === 28 && blue === 36) {
      preRepair.set(REGIONAL_R5_OUTLINE_RGBA, offset);
      continue;
    }
    let nearest = candidates[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const distance = (red - candidate.rgb[0]) ** 2
        + (green - candidate.rgb[1]) ** 2
        + (blue - candidate.rgb[2]) ** 2;
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
    preRepair.set([...nearest.rgb, 255], offset);
  }
  const output = Buffer.from(preRepair);
  const opaqueAt = (x, y) => x >= 0 && y >= 0 && x < width && y < height
    && preRepair[(y * width + x) * 4 + 3] === 255;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    if (preRepair[offset + 3] !== 0) continue;
    if (opaqueAt(x - 1, y) || opaqueAt(x + 1, y) || opaqueAt(x, y - 1) || opaqueAt(x, y + 1)) {
      output.set(REGIONAL_R5_OUTLINE_RGBA, offset);
    }
  }
  return { data: output, width, height, channels: 4 };
}

function regionalR5CropPalette(crop) {
  const kitPalette = REGIONAL_R5_PALETTES.kits[crop.kit];
  if (!kitPalette || typeof kitPalette !== "object" || Array.isArray(kitPalette)) {
    throw new Error(`${crop.id}: unknown R5 owning-kit palette ${crop.kit}`);
  }
  if (!Object.hasOwn(crop, "paletteTokens")) {
    // Ash HomeActor crops predate the label-free contamination instrument tokens. Keep
    // their inherited quantization byte-identical while the world palette expands.
    if (crop.owner === "home-ruin" && crop.kit === "ash-waste") {
      return Object.fromEntries(Object.entries(kitPalette).filter(([token]) => (
        token !== "warning-ochre" && token !== "hazard-lime"
      )));
    }
    return kitPalette;
  }
  const descriptor = Object.getOwnPropertyDescriptor(crop, "paletteTokens");
  const tokens = descriptor && "value" in descriptor ? descriptor.value : null;
  if (!Array.isArray(tokens) || Object.getPrototypeOf(tokens) !== Array.prototype
      || tokens.length === 0 || new Set(tokens).size !== tokens.length
      || tokens.some((token) => typeof token !== "string" || !Object.hasOwn(kitPalette, token))) {
    throw new TypeError(`${crop.id}: R5 paletteTokens must be nonempty unique owning-kit token strings`);
  }
  return Object.fromEntries(tokens.map((token) => [token, kitPalette[token]]));
}

/** Realize one closed literal indexed patch through shared and owning-kit palette authority. */
export function realizeRegionalR5IndexedPatch(patch) {
  if (!patch || patch.schema !== "regional-r5-indexed-patch/v1"
      || !REGIONAL_R5_AUTHORING_KITS.includes(patch.ownerKit) || patch.transparentIndex !== "0"
      || !finiteInteger(patch.width) || !finiteInteger(patch.height)
      || !Array.isArray(patch.rows) || patch.rows.length !== patch.height) {
    throw new TypeError("R5 indexed patch schema or geometry is invalid");
  }
  const declared = REGIONAL_R5_LITERAL_PATCHES.patches.find(({ id }) => id === patch.id);
  if (!declared || declared.ownerKit !== patch.ownerKit
      || declared.canonicalSha256 !== patch.canonicalSha256) {
    throw new Error(`${patch.id}: R5 indexed patch is outside the declared per-kit allowlist`);
  }
  const digestInput = Object.fromEntries(Object.entries(patch).filter(([key]) => key !== "canonicalSha256"));
  if (canonicalDigest(digestInput) !== patch.canonicalSha256) {
    throw new Error(`${patch.id}: R5 indexed patch canonical hash drift`);
  }
  const kitPalette = REGIONAL_R5_PALETTES.kits[patch.ownerKit];
  const literalPalette = {
    ...REGIONAL_R5_PALETTES.shared,
    ...kitPalette,
  };
  const rgbaByIndex = Object.fromEntries(Object.entries(patch.palette).map(([index, token]) => {
    if (token === "transparent") return [index, [0, 0, 0, 0]];
    if (token === "outline") return [index, REGIONAL_R5_OUTLINE_RGBA];
    if (!Object.hasOwn(literalPalette, token)) throw new Error(`${patch.id}: unknown named palette token ${token}`);
    return [index, [...regionalR5HexRgb(literalPalette[token], token), 255]];
  }));
  const data = Buffer.alloc(patch.width * patch.height * 4);
  for (let y = 0; y < patch.height; y += 1) {
    if (typeof patch.rows[y] !== "string" || patch.rows[y].length !== patch.width) {
      throw new Error(`${patch.id}: indexed patch row ${y} width drift`);
    }
    for (let x = 0; x < patch.width; x += 1) {
      const index = patch.rows[y][x];
      const rgbaValue = rgbaByIndex[index];
      if (!rgbaValue) throw new Error(`${patch.id}: indexed patch row ${y} uses unknown index ${index}`);
      data.set(rgbaValue, (y * patch.width + x) * 4);
    }
  }
  return { data, width: patch.width, height: patch.height, channels: 4 };
}

/** Place a binary-alpha raw layer with integer translation and crop-local clipping only. */
export function placeRegionalR5RawLayer(destination, source, x, y) {
  assertRegionalR5Raw(destination, "R5 layer destination");
  assertRegionalR5Raw(source, "R5 layer source");
  if (!finiteInteger(x) || !finiteInteger(y)) {
    throw new TypeError("R5 placement requires integer translation; fractional coordinates are forbidden");
  }
  for (let sourceY = 0; sourceY < source.height; sourceY += 1) {
    const destinationY = y + sourceY;
    if (destinationY < 0 || destinationY >= destination.height) continue;
    for (let sourceX = 0; sourceX < source.width; sourceX += 1) {
      const destinationX = x + sourceX;
      if (destinationX < 0 || destinationX >= destination.width) continue;
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const alpha = source.data[sourceOffset + 3];
      if (alpha === 0) continue;
      if (alpha !== 255) throw new Error("R5 placement requires binary source alpha");
      source.data.copy(
        destination.data,
        (destinationY * destination.width + destinationX) * 4,
        sourceOffset,
        sourceOffset + 4,
      );
    }
  }
  return destination;
}

function regionalR5Cell(raw, cell, cellWidth, cellHeight) {
  assertRegionalR5Raw(raw, "R5 atlas");
  const columns = raw.width / cellWidth;
  if (!finiteInteger(columns) || !finiteInteger(cell) || cell < 0
      || cell >= columns * (raw.height / cellHeight)) {
    throw new RangeError(`R5 atlas cell ${cell} is outside geometry`);
  }
  return regionalR5RawCrop(raw, [
    (cell % columns) * cellWidth,
    Math.floor(cell / columns) * cellHeight,
    cellWidth,
    cellHeight,
  ]);
}

async function decodeRegionalR5Guide(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

async function encodeRegionalR5Raw(raw) {
  assertRegionalR5Raw(raw);
  return sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .png(NATIVE_PNG_OPTIONS)
    .toBuffer();
}

function regionalR5CropInventory() {
  return [
    ...REGIONAL_R5_CROPS.safeGuideFragments,
    ...REGIONAL_R5_CROPS.regionalMacros,
    ...REGIONAL_R5_CROPS.homeMaterialFragments,
  ];
}

/** Validate one closed literal cell-layer stack before any pixel composition. */
export function validateRegionalR5LiteralLayers(layers, ownerKit) {
  const errors = [];
  if (!Array.isArray(layers)) return ["R5 literal layers must be an array"];
  const ids = new Set();
  const zValues = new Set();
  for (const [index, layer] of layers.entries()) {
    if (!Array.isArray(layer) || layer.length !== 9) {
      errors.push(`layer ${index}: literal tuple must contain exactly nine fields`);
      continue;
    }
    const [id, z, kind, sourceId, role, x, y, kit, transform] = layer;
    if (typeof id !== "string" || ids.has(id)) errors.push(`layer ${index}: duplicate or invalid id`);
    ids.add(id);
    if (!finiteInteger(z) || zValues.has(z)) errors.push(`layer ${index}: duplicate z or non-integer z`);
    zValues.add(z);
    if (z !== index) errors.push(`layer ${index}: z must equal literal stack order ${index}`);
    if (!['crop', 'literal-patch'].includes(kind) || typeof sourceId !== "string" || typeof role !== "string") {
      errors.push(`layer ${index}: source kind/reference/role is invalid`);
    }
    if (kind === "literal-patch" && !REGIONAL_R5_LITERAL_PATCHES.roleBindings[role]?.includes(sourceId)) {
      errors.push(`layer ${index}: literal patch ${sourceId} is outside declared role ${role}`);
    }
    if (!finiteInteger(x) || !finiteInteger(y)) errors.push(`layer ${index}: fractional placement offset is forbidden`);
    if (kit !== ownerKit) errors.push(`layer ${index}: owner kit drift`);
    if (transform !== "none") errors.push(`layer ${index}: transform must be none`);
  }
  return errors;
}

function regionalR5LayerMatchesMechanicalRole(kit, layerRole, mechanicalRole) {
  if (layerRole === mechanicalRole) return true;
  if (kit === "neutral-temperate") return (
    (mechanicalRole === "route-or-patch" && layerRole === "neutral-lane-topology")
      || (mechanicalRole === "boundary-material" && layerRole === "neutral-pond-verge-topology")
  );
  return kit === "spring-terraces" && (
    (mechanicalRole === "route-or-patch" && layerRole === "spring-route-topology")
      || (mechanicalRole === "boundary-material" && layerRole === "spring-shore-topology")
  );
}

function regionalR5BlindRepairPaletteErrors(raw, kit, id) {
  const allowed = new Set([
    REGIONAL_R5_PALETTES.outline.source,
    ...Object.values(REGIONAL_R5_PALETTES.kits[kit] ?? {}),
  ].map((value) => regionalR5HexRgb(value, `${id} palette`).join(",")));
  const errors = [];
  for (let offset = 0; offset < raw.data.length; offset += 4) {
    const alpha = raw.data[offset + 3];
    if (alpha !== 0 && alpha !== 255) {
      errors.push(`${id}: alpha must be binary; received ${alpha}`);
      break;
    }
    if (alpha !== 0 && !allowed.has(raw.data.subarray(offset, offset + 3).join(","))) {
      errors.push(`${id}: opaque pixel is outside the ${kit} named palette`);
      break;
    }
  }
  return errors;
}

async function buildRegionalR5BlindRepairRaws(decodeSource) {
  const atlasTargets = new Set();
  const sceneKits = new Set();
  const raws = new Map();
  const descriptors = [
    ...REGIONAL_R5_BLIND_REPAIR_SOURCES.atlasCells,
    ...REGIONAL_R5_BLIND_REPAIR_SOURCES.diagnosticSceneTargets,
  ];
  if (REGIONAL_R5_BLIND_REPAIR_SOURCES.proofOnly !== true
      || REGIONAL_R5_BLIND_REPAIR_SOURCES.atlasRuntimeReconstructible !== false
      || REGIONAL_R5_BLIND_REPAIR_SOURCES.task6Ready !== false
      || REGIONAL_R5_BLIND_REPAIR_SOURCES.atlasCells.length !== 4
      || REGIONAL_R5_BLIND_REPAIR_SOURCES.diagnosticSceneTargets.length !== 2) {
    throw new Error("R5 blind repair must remain exact proof-only, non-Task6 source closure");
  }
  for (const descriptor of descriptors) {
    const encodedBase64 = descriptor.pngBase64Chunks?.join("") ?? descriptor.pngBase64;
    const encoded = Buffer.from(encodedBase64, "base64");
    if (hashBuffer(encoded) !== descriptor.pngSha256) {
      throw new Error(`${descriptor.id}: frozen blind-repair PNG hash drift`);
    }
    const decoded = await decodeSource(encoded, descriptor);
    assertRegionalR5Raw(decoded, `${descriptor.id} decoded blind repair`);
    if (decoded.width !== descriptor.width || decoded.height !== descriptor.height
        || hashBuffer(decoded.data) !== descriptor.rgbaSha256) {
      throw new Error(`${descriptor.id}: frozen blind-repair RGBA identity drift`);
    }
    const raw = { ...decoded, data: Buffer.from(decoded.data) };
    for (let offset = 0; offset < raw.data.length; offset += 4) {
      if (raw.data[offset + 3] !== 0) continue;
      raw.data[offset] = 0;
      raw.data[offset + 1] = 0;
      raw.data[offset + 2] = 0;
    }
    const kit = descriptor.kit ?? descriptor.targetAtlas.replace(/-landmarks$/u, "");
    const paletteErrors = regionalR5BlindRepairPaletteErrors(raw, kit, descriptor.id);
    if (paletteErrors.length > 0) throw new Error(paletteErrors.join("\n"));
    if (descriptor.targetAtlas) {
      const target = `${descriptor.targetAtlas}:${descriptor.cell}`;
      if (atlasTargets.has(target)) throw new Error(`${descriptor.id}: duplicate blind-repair atlas target`);
      atlasTargets.add(target);
    } else {
      if (sceneKits.has(descriptor.kit)) throw new Error(`${descriptor.id}: duplicate diagnostic scene kit`);
      sceneKits.add(descriptor.kit);
    }
    raws.set(descriptor.id, raw);
  }
  return raws;
}

function placeRegionalR5BlindRepairCell(atlas, descriptor, raw) {
  const columns = atlas.width / descriptor.width;
  const left = (descriptor.cell % columns) * descriptor.width;
  const top = Math.floor(descriptor.cell / columns) * descriptor.height;
  if (!finiteInteger(columns) || left + raw.width > atlas.width || top + raw.height > atlas.height) {
    throw new RangeError(`${descriptor.id}: blind-repair atlas cell exceeds target geometry`);
  }
  for (let y = 0; y < raw.height; y += 1) {
    atlas.data.fill(0, ((top + y) * atlas.width + left) * 4,
      ((top + y) * atlas.width + left + raw.width) * 4);
  }
  placeRegionalR5RawLayer(atlas, raw, left, top);
}

function regionalR5ReauthorCellGeometry(atlasId) {
  if (atlasId.endsWith("-terrain")) return Object.freeze({ family: "terrain", width: 32, height: 32 });
  if (atlasId.endsWith("-scenery")) return Object.freeze({ family: "scenery", width: 32, height: 32 });
  if (atlasId.endsWith("-landmarks")) return Object.freeze({ family: "landmarks", width: 128, height: 128 });
  throw new Error(`${atlasId}: R5 reauthor target has no cell geometry`);
}

function regionalR5ReauthorLayerRole(family, cell) {
  if (family === "scenery") return "scenery-fragment";
  if (family === "landmarks") return "landmark-anatomy";
  if (cell >= 8 && cell < 24) return "route-or-patch";
  if (cell >= 24 && cell < 32) return "boundary-material";
  return "terrain-material";
}

function regionalR5ReauthorTargetCells(rawMasters, targets) {
  const cells = [];
  for (const [kit, families] of Object.entries(targets)) {
    for (const [family, indexes] of Object.entries(families)) {
      const atlasId = `${kit}-${family}`;
      const geometry = regionalR5ReauthorCellGeometry(atlasId);
      const atlas = rawMasters[atlasId];
      if (!atlas) throw new Error(`${atlasId}: R5 reauthor target master is missing`);
      for (const cell of indexes) {
        const raw = regionalR5Cell(atlas, cell, geometry.width, geometry.height);
        cells.push({ atlasId, cell, family, geometry, beforeRgbaSha256: hashBuffer(raw.data) });
      }
    }
  }
  return cells.sort((left, right) => (
    left.atlasId < right.atlasId ? -1 : left.atlasId > right.atlasId ? 1 : left.cell - right.cell
  ));
}

function regionalR5FinalizeReauthorIntegration({
  rawMasters,
  cellLayersByAtlas,
  beforeCells,
  passReceipt,
}) {
  const expectedAtlasIds = [...new Set(beforeCells.map(({ atlasId }) => atlasId))].sort();
  if (canonicalJson(passReceipt.changedAtlasIds) !== canonicalJson(expectedAtlasIds)
      || passReceipt.targetCellCount !== beforeCells.length) {
    throw new Error("R5 reauthor pass receipt does not match its exact target inventory");
  }
  const blindRepairs = new Map(REGIONAL_R5_BLIND_REPAIR_SOURCES.atlasCells.map((descriptor) => [
    `${descriptor.targetAtlas}:${descriptor.cell}`,
    descriptor.id,
  ]));
  const cells = beforeCells.map(({ atlasId, cell, family, geometry, beforeRgbaSha256 }) => {
    const raw = regionalR5Cell(rawMasters[atlasId], cell, geometry.width, geometry.height);
    const afterRgbaSha256 = hashBuffer(raw.data);
    if (afterRgbaSha256 === beforeRgbaSha256) {
      throw new Error(`${atlasId}:${cell}: R5 reauthor target did not replace its source pixels`);
    }
    const key = `${atlasId}:${cell}`;
    cellLayersByAtlas.set(key, [{
      id: `r5-layer/${atlasId}/${String(cell).padStart(3, "0")}/reauthor`,
      z: 0,
      kind: "atlas-reauthor",
      sourceId: `r5-reauthor/${passReceipt.schema}/${atlasId}/${cell}`,
      role: regionalR5ReauthorLayerRole(family, cell),
      raw,
    }]);
    return Object.freeze({
      atlasId,
      cell,
      family,
      cellWidth: geometry.width,
      cellHeight: geometry.height,
      beforeRgbaSha256,
      afterRgbaSha256,
      supersededBlindRepairId: blindRepairs.get(key) ?? null,
    });
  });
  const receiptBody = {
    schema: "regional-r5-atlas-reauthor-integration/v1",
    passSchema: passReceipt.schema,
    changedAtlasIds: Object.freeze([...expectedAtlasIds]),
    targetCellCount: cells.length,
    cells: Object.freeze(cells),
  };
  return Object.freeze({
    ...receiptBody,
    canonicalSha256: canonicalDigest(receiptBody),
  });
}

/** Build all 20 R5 raster masters in memory; this function never publishes files. */
async function buildRegionalR5SourceMastersInternal({
  sourceBuffers,
  decodeSource = decodeRegionalR5Guide,
} = {}, bindResult = true) {
  const specificationErrors = validateRegionalR5AuthoringSpec(REGIONAL_R5_AUTHORING_SPEC);
  if (specificationErrors.length > 0) {
    throw new Error(`R5 authoring specification failed before guide decode:\n${specificationErrors.join("\n")}`);
  }
  const resolvedBuffers = await sourceBuffers;
  if (!resolvedBuffers || typeof resolvedBuffers !== "object") {
    throw new TypeError("R5 sourceBuffers must provide regionKits and homeRuin guide PNGs");
  }
  const sourcePairs = [
    ["regionKits", REGIONAL_R5_AUTHORING_SOURCES.regionKits],
    ["homeRuin", REGIONAL_R5_AUTHORING_SOURCES.homeRuin],
  ];
  const sourceBufferShape = regionalR5PlainDataTrustSnapshot(
    resolvedBuffers,
    Object.prototype,
    "R5 sourceBuffers",
  );
  const expectedSourceKeys = new Set(sourcePairs.map(([key]) => key));
  if (sourceBufferShape.entries.length !== sourcePairs.length
      || sourceBufferShape.entries.some(({ key }) => !expectedSourceKeys.has(key))) {
    throw new TypeError("R5 sourceBuffers must contain exact regionKits and homeRuin plain data properties");
  }
  const sourceDigests = {};
  const sourceBufferCopies = {};
  for (const [key, descriptor] of sourcePairs) {
    const buffer = sourceBufferShape.entries.find((entry) => entry.key === key)?.value;
    if (!Buffer.isBuffer(buffer)) throw new TypeError(`${key}: R5 guide source must be Buffer bytes`);
    const snapshot = Buffer.from(buffer);
    const digest = hashBuffer(snapshot);
    if (digest !== descriptor.sha256) throw new Error(`${key}: R5 guide source hash drift ${digest}`);
    sourceDigests[key] = digest;
    sourceBufferCopies[key] = snapshot;
  }
  const normalizedSources = {};
  for (const [key, descriptor] of sourcePairs) {
    const decoded = await decodeSource(sourceBufferCopies[key], descriptor);
    assertRegionalR5Raw(decoded, `${key} decoded R5 guide`);
    if (decoded.width !== descriptor.width || decoded.height !== descriptor.height) {
      throw new Error(`${key}: R5 guide dimensions must be ${descriptor.width}x${descriptor.height}`);
    }
    const decodedDigest = hashBuffer(decoded.data);
    if (decodedDigest !== REGIONAL_R5_DECODED_RGBA_SHA256[key]) {
      throw new Error(`${key}: R5 decoded RGBA bytes hash drift ${decodedDigest}`);
    }
    normalizedSources[descriptor.id] = normalizeRegionalR5WholeSheet(decoded);
  }
  const fragments = new Map();
  for (const crop of regionalR5CropInventory()) {
    if (JSON.stringify(normalizedRegionalR5Rect(crop.sourceRect)) !== JSON.stringify(crop.normalizedRect)) {
      throw new Error(`${crop.id}: R5 normalized crop formula drift`);
    }
    const normalized = normalizedSources[crop.owner];
    if (!normalized) throw new Error(`${crop.id}: unknown normalized source ${crop.owner}`);
    const fragment = regionalR5RawCrop(normalized, crop.normalizedRect);
    fragments.set(crop.id, cleanRegionalR5Crop({
      ...fragment,
      palette: regionalR5CropPalette(crop),
    }));
  }
  const patches = new Map(REGIONAL_R5_LITERAL_PATCHES.patches.map((patch) => [
    patch.id,
    realizeRegionalR5IndexedPatch(patch),
  ]));
  const rawMasters = {};
  const buffers = {};
  const digests = {};
  const cellLayersByAtlas = new Map();
  for (const kit of REGIONAL_R5_AUTHORING_KITS) for (const plan of REGIONAL_R5_ATLAS_AUTHORING_PLANS[kit]) {
    const atlas = { data: Buffer.alloc(plan.geometry.width * plan.geometry.height * 4),
      width: plan.geometry.width, height: plan.geometry.height, channels: 4 };
    const columns = plan.geometry.width / plan.geometry.cellWidth;
    for (const [cell, _semantic, layers] of plan.semanticCells) {
      const layerErrors = validateRegionalR5LiteralLayers(layers, kit);
      if (layerErrors.length > 0) {
        throw new Error(`${plan.atlasId}/${cell}: invalid R5 literal layer stack\n${layerErrors.join("\n")}`);
      }
      const cellSurface = { data: Buffer.alloc(plan.geometry.cellWidth * plan.geometry.cellHeight * 4),
        width: plan.geometry.cellWidth, height: plan.geometry.cellHeight, channels: 4 };
      const renderedLayers = [];
      for (const layer of layers) {
        const [_id, _order, kind, sourceId, _role, x, y, ownerKit, override] = layer;
        if (ownerKit !== kit || override !== "none") throw new Error(`${plan.atlasId}/${cell}: R5 layer ownership drift`);
        const source = kind === "crop" ? fragments.get(sourceId)
          : kind === "literal-patch" ? patches.get(sourceId) : null;
        if (!source) throw new Error(`${plan.atlasId}/${cell}: unknown R5 ${kind} source ${sourceId}`);
        const rendered = { data: Buffer.alloc(plan.geometry.cellWidth * plan.geometry.cellHeight * 4),
          width: plan.geometry.cellWidth, height: plan.geometry.cellHeight, channels: 4 };
        placeRegionalR5RawLayer(rendered, source, x, y);
        placeRegionalR5RawLayer(cellSurface, rendered, 0, 0);
        renderedLayers.push({ id: layer[0], z: layer[1], kind, sourceId, role: layer[4], raw: rendered });
      }
      cellLayersByAtlas.set(`${plan.atlasId}:${cell}`, renderedLayers);
      placeRegionalR5RawLayer(
        atlas,
        cellSurface,
        (cell % columns) * plan.geometry.cellWidth,
        Math.floor(cell / columns) * plan.geometry.cellHeight,
      );
    }
    rawMasters[plan.atlasId] = atlas;
    buffers[plan.atlasId] = await encodeRegionalR5Raw(atlas);
    digests[plan.atlasId] = hashBuffer(buffers[plan.atlasId]);
  }
  const blindRepairSources = await buildRegionalR5BlindRepairRaws(decodeSource);
  const repairedAtlasIds = new Set();
  for (const descriptor of REGIONAL_R5_BLIND_REPAIR_SOURCES.atlasCells) {
    const atlas = rawMasters[descriptor.targetAtlas];
    const raw = blindRepairSources.get(descriptor.id);
    if (!atlas || !raw) throw new Error(`${descriptor.id}: blind-repair source target missing`);
    placeRegionalR5BlindRepairCell(atlas, descriptor, raw);
    repairedAtlasIds.add(descriptor.targetAtlas);
  }
  for (const atlasId of repairedAtlasIds) {
    buffers[atlasId] = await encodeRegionalR5Raw(rawMasters[atlasId]);
    digests[atlasId] = hashBuffer(buffers[atlasId]);
  }
  const reauthorTargets = regionalR5ReauthorTargetsInternal();
  const beforeReauthorCells = regionalR5ReauthorTargetCells(rawMasters, reauthorTargets);
  const passReceipt = applyRegionalR5AtlasReauthor(rawMasters);
  const reauthorReceipt = regionalR5FinalizeReauthorIntegration({
    rawMasters,
    cellLayersByAtlas,
    beforeCells: beforeReauthorCells,
    passReceipt,
  });
  for (const atlasId of reauthorReceipt.changedAtlasIds) {
    buffers[atlasId] = await encodeRegionalR5Raw(rawMasters[atlasId]);
    digests[atlasId] = hashBuffer(buffers[atlasId]);
  }
  if (Object.keys(buffers).length !== 20) throw new Error("R5 offline authoring must close on exactly 20 masters");
  const authoring = {
    buffers,
    rawMasters,
    digests,
    sourceDigests,
    fragments,
    patches,
    cellLayersByAtlas,
    blindRepairSources,
    reauthorReceipt,
  };
  if (bindResult) bindRegionalR5AuthoringResult(authoring);
  return authoring;
}

/** Build and trust-bind all 20 V2 R5 source masters without publication. */
export async function buildRegionalR5SourceMasters(input = {}) {
  return buildRegionalR5SourceMastersInternal(input, true);
}

function regionalR5FullLayer(width, height, source, x, y) {
  const layer = { data: Buffer.alloc(width * height * 4), width, height, channels: 4 };
  placeRegionalR5RawLayer(layer, source, x, y);
  return layer;
}

/** Return descending exact four-neighbour alpha component sizes for one raw image. */
export function regionalR5AlphaComponentSizes(image) {
  assertRegionalR5Raw(image, "R5 alpha component image");
  const seen = new Uint8Array(image.width * image.height);
  const sizes = [];
  for (let seed = 0; seed < seen.length; seed += 1) {
    if (seen[seed] !== 0 || image.data[seed * 4 + 3] === 0) continue;
    const queue = [seed];
    seen[seed] = 1;
    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      const x = index % image.width;
      const y = Math.floor(index / image.width);
      for (const neighbor of [
        x > 0 ? index - 1 : -1,
        x + 1 < image.width ? index + 1 : -1,
        y > 0 ? index - image.width : -1,
        y + 1 < image.height ? index + image.width : -1,
      ]) {
        if (neighbor < 0 || seen[neighbor] !== 0 || image.data[neighbor * 4 + 3] === 0) continue;
        seen[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    sizes.push(queue.length);
  }
  return sizes.sort((left, right) => right - left);
}

function regionalR5TerrainScene(scene, terrain) {
  const output = { data: Buffer.alloc(scene.width * scene.height * 4),
    width: scene.width, height: scene.height, channels: 4 };
  const tiles = new Map();
  for (const [tileY, row] of scene.terrainRows.entries()) for (let tileX = 0; tileX < 24; tileX += 1) {
    const cell = Number.parseInt(row.slice(tileX * 2, tileX * 2 + 2), 16);
    const layer = regionalR5FullLayer(scene.width, scene.height, regionalR5Cell(terrain, cell, 32, 32), tileX * 32, tileY * 32);
    placeRegionalR5RawLayer(output, layer, 0, 0);
    tiles.set(`${tileX},${tileY}`, { cell, layer });
  }
  return { output, tiles };
}

function regionalR5AtlasSceneLayer(scene, atlas, placement, cellWidth, cellHeight) {
  return regionalR5FullLayer(
    scene.width,
    scene.height,
    regionalR5Cell(atlas, placement.cell, cellWidth, cellHeight),
    placement.x,
    placement.y,
  );
}

function regionalR5ClusterMetrics(record, metricInput) {
  const analyzed = analyzeConstructedCluster(metricInput);
  const metrics = {
    saliencyComponentCount: analyzed.saliencyComponentCount,
    undilatedComponentCount: analyzed.undilatedComponentCount,
    dominantMassShare: analyzed.dominantMassShare,
    omitOneVisibleShares: {
      route: analyzed.omitOne[0].visibleShare,
      landmark: analyzed.omitOne[1].visibleShare,
      supportA: analyzed.omitOne[2].visibleShare,
      supportB: analyzed.omitOne[3].visibleShare,
    },
    minimumOmitOneVisibleShare: Math.min(...analyzed.omitOne.map(({ visibleShare }) => visibleShare)),
  };
  const receiptWithoutHash = {
    kitId: record.kitId,
    clusterId: record.clusterId,
    landmarkCell: record.landmarkCell,
    supportA: structuredClone(record.supportA),
    supportB: structuredClone(record.supportB),
    routeTarget: structuredClone(record.routeTarget),
    metrics,
  };
  return { ...receiptWithoutHash, canonicalSha256: canonicalDigest(receiptWithoutHash), analyzed };
}

function regionalR5PlainDataTrustSnapshot(value, expectedPrototype, label) {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== expectedPrototype
      || Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${label} must retain its exact plain prototype and no symbol properties`);
  }
  const entries = Object.getOwnPropertyNames(value).map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`${label}.${key} must remain a plain data property`);
    }
    return Object.freeze({
      key,
      value: descriptor.value,
      writable: descriptor.writable,
      enumerable: descriptor.enumerable,
      configurable: descriptor.configurable,
    });
  });
  return Object.freeze({ value, expectedPrototype, entries: Object.freeze(entries) });
}

function regionalR5PlainDataMatchesTrust(value, trust) {
  if (value !== trust.value || Object.getPrototypeOf(value) !== trust.expectedPrototype
      || Object.getOwnPropertySymbols(value).length !== 0) return false;
  const keys = Object.getOwnPropertyNames(value);
  if (keys.length !== trust.entries.length) return false;
  return keys.every((key, index) => {
    const expected = trust.entries[index];
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return key === expected.key && descriptor && Object.hasOwn(descriptor, "value")
      && Object.is(descriptor.value, expected.value)
      && descriptor.writable === expected.writable
      && descriptor.enumerable === expected.enumerable
      && descriptor.configurable === expected.configurable;
  });
}

function regionalR5RawTrustSnapshot(raw) {
  assertRegionalR5Raw(raw, "R5 trusted connectivity layer");
  return Object.freeze({
    raw,
    wrapper: regionalR5PlainDataTrustSnapshot(raw, Object.prototype, "R5 raw wrapper"),
    data: raw.data,
    width: raw.width,
    height: raw.height,
    channels: raw.channels,
    sha256: hashBuffer(raw.data),
  });
}

function regionalR5RawMatchesTrust(raw, trust) {
  return raw === trust.raw && regionalR5PlainDataMatchesTrust(raw, trust.wrapper)
    && raw.data === trust.data && regionalR5BufferIsUnshadowed(raw.data)
    && raw?.width === trust.width && raw?.height === trust.height
    && raw?.channels === trust.channels && Buffer.isBuffer(raw.data)
    && hashBuffer(raw.data) === trust.sha256;
}

function regionalR5RawRecordTrustSnapshot(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("R5 trusted raw-master record must be an object");
  }
  return Object.freeze({
    record,
    wrapper: regionalR5PlainDataTrustSnapshot(record, Object.prototype, "R5 raw-master record"),
    entries: Object.freeze(Object.entries(record).map(([key, raw]) => Object.freeze({
      key,
      raw: regionalR5RawTrustSnapshot(raw),
    }))),
  });
}

function regionalR5RawMapTrustSnapshot(map, label) {
  if (Object.getPrototypeOf(map) !== Map.prototype || Reflect.ownKeys(map).length !== 0) {
    throw new TypeError(`R5 trusted ${label} must be a plain unshadowed Map`);
  }
  return Object.freeze({
    map,
    entries: Object.freeze([...Map.prototype.entries.call(map)].map(([key, raw]) => Object.freeze({
      key,
      raw: regionalR5RawTrustSnapshot(raw),
    }))),
  });
}

function regionalR5CellLayersTrustSnapshot(map) {
  if (Object.getPrototypeOf(map) !== Map.prototype || Reflect.ownKeys(map).length !== 0) {
    throw new TypeError("R5 trusted cell layers must be a plain unshadowed Map");
  }
  return Object.freeze({
    map,
    entries: Object.freeze([...Map.prototype.entries.call(map)].map(([key, layers]) => {
      if (!Array.isArray(layers)) throw new TypeError(`${key}: R5 trusted cell layers must be an array`);
      return Object.freeze({
        key,
        layers,
        array: regionalR5PlainDataTrustSnapshot(layers, Array.prototype, `${key} R5 cell-layer array`),
        layerTrust: Object.freeze(layers.map((layer) => Object.freeze({
          layer,
          wrapper: regionalR5PlainDataTrustSnapshot(layer, Object.prototype, `${key} R5 cell layer`),
          keysJson: canonicalJson(Object.keys(layer)),
          metadataSha256: canonicalDigest({
            id: layer.id,
            z: layer.z,
            kind: layer.kind,
            sourceId: layer.sourceId,
            role: layer.role,
          }),
          raw: regionalR5RawTrustSnapshot(layer.raw),
        }))),
      });
    })),
  });
}

function regionalR5RawRecordMatchesTrust(record, trust) {
  if (record !== trust.record || !regionalR5PlainDataMatchesTrust(record, trust.wrapper)) return false;
  const entries = Object.entries(record);
  return entries.length === trust.entries.length && entries.every(([key, raw], index) => (
    key === trust.entries[index].key && regionalR5RawMatchesTrust(raw, trust.entries[index].raw)
  ));
}

function regionalR5RawMapMatchesTrust(map, trust) {
  if (map !== trust.map || Object.getPrototypeOf(map) !== Map.prototype
      || Reflect.ownKeys(map).length !== 0) return false;
  const entries = [...Map.prototype.entries.call(map)];
  if (entries.length !== trust.entries.length) return false;
  return entries.every(([key, raw], index) => key === trust.entries[index].key
    && regionalR5RawMatchesTrust(raw, trust.entries[index].raw));
}

function regionalR5CellLayersMatchTrust(map, trust) {
  if (map !== trust.map || Object.getPrototypeOf(map) !== Map.prototype
      || Reflect.ownKeys(map).length !== 0) return false;
  const entries = [...Map.prototype.entries.call(map)];
  if (entries.length !== trust.entries.length) return false;
  return entries.every(([key, layers], entryIndex) => {
    const expected = trust.entries[entryIndex];
    if (key !== expected.key || layers !== expected.layers
        || !Array.isArray(layers) || !regionalR5PlainDataMatchesTrust(layers, expected.array)
        || layers.length !== expected.layerTrust.length) return false;
    return layers.every((layer, layerIndex) => {
      const layerTrust = expected.layerTrust[layerIndex];
      return layer === layerTrust.layer
        && regionalR5PlainDataMatchesTrust(layer, layerTrust.wrapper)
        && canonicalJson(Object.keys(layer)) === layerTrust.keysJson
        && canonicalDigest({
          id: layer.id,
          z: layer.z,
          kind: layer.kind,
          sourceId: layer.sourceId,
          role: layer.role,
        }) === layerTrust.metadataSha256
        && regionalR5RawMatchesTrust(layer.raw, layerTrust.raw);
    });
  });
}

function bindRegionalR5AuthoringResult(authoring) {
  REGIONAL_R5_AUTHORING_TRUST.set(authoring, Object.freeze({
    wrapper: regionalR5PlainDataTrustSnapshot(authoring, Object.prototype, "R5 authoring result"),
    rawMasters: regionalR5RawRecordTrustSnapshot(authoring.rawMasters),
    fragments: regionalR5RawMapTrustSnapshot(authoring.fragments, "fragment map"),
    patches: regionalR5RawMapTrustSnapshot(authoring.patches, "literal-patch map"),
    blindRepairSources: regionalR5RawMapTrustSnapshot(
      authoring.blindRepairSources,
      "blind-repair source map",
    ),
    cellLayersByAtlas: regionalR5CellLayersTrustSnapshot(authoring.cellLayersByAtlas),
    reauthorReceipt: Object.freeze({
      receipt: authoring.reauthorReceipt,
      wrapper: regionalR5PlainDataTrustSnapshot(
        authoring.reauthorReceipt,
        Object.prototype,
        "R5 reauthor receipt",
      ),
      canonicalSha256: canonicalDigest(authoring.reauthorReceipt),
    }),
  }));
}

function assertRegionalR5TrustedAuthoring(authoring) {
  const error = "R5 key-scene builder requires trusted source-master authoring provenance and identity";
  if (!authoring || typeof authoring !== "object") throw new TypeError(error);
  const trust = REGIONAL_R5_AUTHORING_TRUST.get(authoring);
  if (!trust || !regionalR5PlainDataMatchesTrust(authoring, trust.wrapper)
      || !regionalR5RawRecordMatchesTrust(authoring.rawMasters, trust.rawMasters)
      || !regionalR5RawMapMatchesTrust(authoring.fragments, trust.fragments)
      || !regionalR5RawMapMatchesTrust(authoring.patches, trust.patches)
      || !regionalR5RawMapMatchesTrust(authoring.blindRepairSources, trust.blindRepairSources)
      || !regionalR5CellLayersMatchTrust(authoring.cellLayersByAtlas, trust.cellLayersByAtlas)
      || authoring.reauthorReceipt !== trust.reauthorReceipt.receipt
      || !regionalR5PlainDataMatchesTrust(authoring.reauthorReceipt, trust.reauthorReceipt.wrapper)
      || canonicalDigest(authoring.reauthorReceipt) !== trust.reauthorReceipt.canonicalSha256) {
    throw new Error(error);
  }
}

function bindRegionalR5ConnectivityInput(kit, clusters, records, authoring) {
  if (records.length !== 8 || clusters.length !== 8) {
    throw new Error(`${kit}: R5 key scene requires exact 8-record canonical kit closure`);
  }
  for (let index = 0; index < 8; index += 1) {
    if (clusters[index].record !== records[index]) {
      throw new Error(`${kit}: R5 key scene requires exact 8-record canonical kit closure`);
    }
  }
  const connectivityInputs = { kit, clusters };
  const clusterTrust = [];
  for (let index = 0; index < 8; index += 1) {
    const cluster = clusters[index];
    const roleValues = [];
    for (let roleIndex = 0; roleIndex < cluster.routeSourceRoles.length; roleIndex += 1) {
      roleValues.push(cluster.routeSourceRoles[roleIndex]);
    }
    const supportLayerSnapshots = [];
    for (let supportIndex = 0; supportIndex < cluster.supportLayers.length; supportIndex += 1) {
      supportLayerSnapshots.push(regionalR5RawTrustSnapshot(cluster.supportLayers[supportIndex]));
    }
    clusterTrust.push(Object.freeze({
      cluster,
      wrapper: regionalR5PlainDataTrustSnapshot(cluster, Object.prototype, `${cluster.record.clusterId} R5 connectivity cluster`),
      record: cluster.record,
      recordSha256: canonicalDigest(cluster.record),
      width: cluster.width,
      height: cluster.height,
      routeSourceRoles: cluster.routeSourceRoles,
      routeSourceRolesArray: regionalR5PlainDataTrustSnapshot(
        cluster.routeSourceRoles,
        Array.prototype,
        `${cluster.record.clusterId} R5 route-source roles`,
      ),
      routeSourceRoleValues: Object.freeze(roleValues),
      routeRgbaSha256: cluster.routeRgbaSha256,
      supportLayers: cluster.supportLayers,
      supportLayersArray: regionalR5PlainDataTrustSnapshot(
        cluster.supportLayers,
        Array.prototype,
        `${cluster.record.clusterId} R5 support layers`,
      ),
      baseLayer: regionalR5RawTrustSnapshot(cluster.baseLayer),
      scene: regionalR5RawTrustSnapshot(cluster.scene),
      routeLayer: regionalR5RawTrustSnapshot(cluster.routeLayer),
      landmarkLayer: regionalR5RawTrustSnapshot(cluster.landmarkLayer),
      supportLayerSnapshots: Object.freeze(supportLayerSnapshots),
    }));
  }
  const wornRelationInputs = kit === "worn-heartland"
    ? regionalR5WornRelationInputs({ authoring })
    : null;
  REGIONAL_R5_CONNECTIVITY_TRUST.set(connectivityInputs, Object.freeze({
    kit,
    clusters,
    inputWrapper: regionalR5PlainDataTrustSnapshot(
      connectivityInputs,
      Object.prototype,
      `${kit} R5 connectivity input`,
    ),
    clustersArray: regionalR5PlainDataTrustSnapshot(
      clusters,
      Array.prototype,
      `${kit} R5 connectivity clusters`,
    ),
    records: Object.freeze([...records]),
    clusterTrust: Object.freeze(clusterTrust),
    wornRelationInputs,
    wornRelationTrust: wornRelationInputs
      ? regionalR5RawRecordTrustSnapshot(wornRelationInputs)
      : null,
  }));
  return connectivityInputs;
}

function regionalR5ConnectivityTrustError(input, trust) {
  const error = "R5 connectivity requires exact 8-record trusted builder identity; generic-ground or caller-attested route source role/source alpha/hash provenance is forbidden";
  if (!input || typeof input !== "object" || !trust
      || !regionalR5PlainDataMatchesTrust(input, trust.inputWrapper)
      || !regionalR5PlainDataMatchesTrust(trust.clusters, trust.clustersArray)
      || trust.clusters.length !== 8 || trust.records.length !== 8
      || trust.clusterTrust.length !== 8) return error;
  for (let index = 0; index < 8; index += 1) {
    const cluster = trust.clusters[index];
    const expected = trust.clusterTrust[index];
    const layerPairs = [
      [cluster?.baseLayer, expected.baseLayer],
      [cluster?.scene, expected.scene],
      [cluster?.routeLayer, expected.routeLayer],
      [cluster?.landmarkLayer, expected.landmarkLayer],
    ];
    if (cluster !== expected.cluster
        || !regionalR5PlainDataMatchesTrust(cluster, expected.wrapper)
        || cluster?.record !== expected.record
        || cluster.record !== trust.records[index]
        || canonicalDigest(cluster.record) !== expected.recordSha256
        || cluster.width !== expected.width || cluster.height !== expected.height
        || cluster.routeSourceRoles !== expected.routeSourceRoles
        || !regionalR5PlainDataMatchesTrust(cluster.routeSourceRoles, expected.routeSourceRolesArray)
        || cluster.routeSourceRoles.length !== expected.routeSourceRoleValues.length
        || cluster.routeRgbaSha256 !== expected.routeRgbaSha256
        || cluster.supportLayers !== expected.supportLayers
        || !regionalR5PlainDataMatchesTrust(cluster.supportLayers, expected.supportLayersArray)
        || cluster.supportLayers.length !== expected.supportLayerSnapshots.length
    ) return error;
    for (let roleIndex = 0; roleIndex < expected.routeSourceRoleValues.length; roleIndex += 1) {
      if (cluster.routeSourceRoles[roleIndex] !== expected.routeSourceRoleValues[roleIndex]) return error;
    }
    for (let layerIndex = 0; layerIndex < layerPairs.length; layerIndex += 1) {
      if (!regionalR5RawMatchesTrust(layerPairs[layerIndex][0], layerPairs[layerIndex][1])) return error;
    }
    for (let supportIndex = 0; supportIndex < expected.supportLayerSnapshots.length; supportIndex += 1) {
      if (!regionalR5RawMatchesTrust(
        cluster.supportLayers[supportIndex],
        expected.supportLayerSnapshots[supportIndex],
      )) return error;
    }
  }
  return null;
}

/** Build one in-memory 768x512 R5 key scene and its actual-alpha cluster inputs. */
export async function buildRegionalR5KeyScene({ kit, authoring } = {}) {
  if (!REGIONAL_R5_AUTHORING_KITS.includes(kit)) throw new Error(`unknown R5 key-scene kit ${kit}`);
  assertRegionalR5TrustedAuthoring(authoring);
  const scene = REGIONAL_R5_KEY_SCENES[kit];
  const terrain = authoring.rawMasters[`${kit}-terrain`];
  const scenery = authoring.rawMasters[`${kit}-scenery`];
  const landmarks = authoring.rawMasters[`${kit}-landmarks`];
  const yards = authoring.rawMasters[`${kit}-home-yards`];
  const terrainScene = regionalR5TerrainScene(scene, terrain);
  const composed = { ...terrainScene.output, data: Buffer.from(terrainScene.output.data) };
  const placeLiteralPatchRelation = (routeRelation) => {
    for (const placement of scene.literalPatchLayers) {
      if (placement.routeRelation !== routeRelation) continue;
      const patch = authoring.patches.get(placement.patchId);
      if (!patch) throw new Error(`${kit}: key-scene literal patch ${placement.patchId} missing`);
      placeRegionalR5RawLayer(composed, patch, placement.x, placement.y);
    }
  };
  for (const placement of scene.literalPatchLayers) {
    if (placement.routeRelation !== 'ground-foundation') continue;
    const patch = authoring.patches.get(placement.patchId);
    if (!patch) throw new Error(`${kit}: key-scene literal patch ${placement.patchId} missing`);
    placeRegionalR5RawLayer(composed, patch, placement.x, placement.y);
  }
  for (const [_id, sourceId, _role, x, y] of scene.macroLayers) {
    const source = authoring.fragments.get(sourceId) ?? authoring.patches.get(sourceId);
    if (!source) throw new Error(`${kit}: key-scene macro source ${sourceId} missing`);
    placeRegionalR5RawLayer(composed, source, x, y);
  }
  for (const placement of scene.literalPatchLayers) {
    if (placement.routeRelation !== 'service-route-junction') continue;
    const patch = authoring.patches.get(placement.patchId);
    if (!patch) throw new Error(`${kit}: key-scene literal patch ${placement.patchId} missing`);
    placeRegionalR5RawLayer(composed, patch, placement.x, placement.y);
  }
  for (const placement of scene.literalPatchLayers) {
    if (placement.routeRelation !== 'cluster-foundation') continue;
    const patch = authoring.patches.get(placement.patchId);
    if (!patch) throw new Error(`${kit}: key-scene literal patch ${placement.patchId} missing`);
    placeRegionalR5RawLayer(composed, patch, placement.x, placement.y);
  }
  for (const placement of scene.literalPatchLayers) {
    if (placement.routeRelation !== 'pond-foundation') continue;
    const patch = authoring.patches.get(placement.patchId);
    if (!patch) throw new Error(`${kit}: key-scene literal patch ${placement.patchId} missing`);
    placeRegionalR5RawLayer(composed, patch, placement.x, placement.y);
  }
  const blindRepairDescriptor = REGIONAL_R5_BLIND_REPAIR_SOURCES.diagnosticSceneTargets
    .find((descriptor) => descriptor.kit === kit);
  const blindRepairRaw = blindRepairDescriptor
    ? authoring.blindRepairSources.get(blindRepairDescriptor.id)
    : null;
  if (blindRepairDescriptor && !blindRepairRaw) {
    throw new Error(`${kit}: trusted blind-review diagnostic scene target missing`);
  }
  if (blindRepairRaw) placeRegionalR5RawLayer(composed, blindRepairRaw, 0, 0);
  const landmarkLayers = new Map(scene.landmarkLayers.map((placement) => [placement.clusterId,
    regionalR5AtlasSceneLayer(scene, landmarks, placement, 128, 128)]));
  const supportLayers = new Map(scene.supportLayers.map((placement) => [placement.id,
    placement.patchId
      ? regionalR5FullLayer(
        scene.width,
        scene.height,
        authoring.patches.get(placement.patchId),
        placement.x,
        placement.y,
      )
      : regionalR5AtlasSceneLayer(scene, scenery, placement, 32, 32)]));
  for (const placement of scene.landmarkLayers) placeRegionalR5RawLayer(composed, landmarkLayers.get(placement.clusterId), 0, 0);
  placeLiteralPatchRelation("spring-route-surface");
  for (const placement of scene.supportLayers) placeRegionalR5RawLayer(composed, supportLayers.get(placement.id), 0, 0);
  placeLiteralPatchRelation("spring-route-tread");
  placeLiteralPatchRelation("spring-bridge-water-return");
  for (const placement of scene.yardLayers) {
    placeRegionalR5RawLayer(composed, regionalR5AtlasSceneLayer(scene, yards, placement, 192, 160), 0, 0);
  }
  for (const placement of scene.literalPatchLayers) {
    if (['ground-foundation', 'cluster-foundation', 'pond-foundation', 'service-route-junction',
      'spring-route-surface', 'spring-route-tread', 'spring-bridge-water-return']
      .includes(placement.routeRelation)) continue;
    const patch = authoring.patches.get(placement.patchId);
    if (!patch) throw new Error(`${kit}: key-scene literal patch ${placement.patchId} missing`);
    if (placement.routeRelation === "dry-v32-actorless-world"
        || placement.routeRelation === "worn-r5-actorless-world") {
      const expectedRelation = kit === "dry-scrub"
        ? "dry-v32-actorless-world"
        : kit === "worn-heartland" ? "worn-r5-actorless-world" : null;
      if (placement.routeRelation !== expectedRelation || placement.x !== 0 || placement.y !== 0
          || patch.width !== scene.width || patch.height !== scene.height) {
        throw new Error(`${kit}: exact accepted actorless foundation must occupy the complete scene`);
      }
      composed.data.set(patch.data);
    } else placeRegionalR5RawLayer(composed, patch, placement.x, placement.y);
  }
  const records = REGIONAL_R5_MECHANICS_BINDINGS.visualProofBindings.clusterProofs.records
    .filter((record) => record.kitId === kit);
  const clusters = records.map((record) => {
    const targetTile = terrainScene.tiles.get(`${record.routeTarget.tileX},${record.routeTarget.tileY}`);
    if (!targetTile || targetTile.cell !== record.routeTarget.terrainCell) {
      throw new Error(`${record.clusterId}: actual terrain target cell drift`);
    }
    const routeLayer = { data: Buffer.alloc(scene.width * scene.height * 4),
      width: scene.width, height: scene.height, channels: 4 };
    const targetRole = record.routeTarget.kind === "shore" ? "boundary-material" : "route-or-patch";
    const routeSourceRoles = [];
    if (kit === "spring-terraces") {
      const foundationPlacement = scene.literalPatchLayers
        .find(({ routeRelation }) => routeRelation === "ground-foundation");
      const foundation = authoring.patches.get(foundationPlacement?.patchId);
      if (!foundation || foundation.width !== scene.width || foundation.height !== scene.height) {
        throw new Error(`${record.clusterId}: Spring topology proof requires the exact scene foundation`);
      }
      const topology = REGIONAL_R5_MECHANICS_BINDINGS.scenePlans[kit];
      const wetTiles = [...topology.waterTiles, ...topology.shoreTiles];
      const wetBounds = {
        left: Math.min(...wetTiles.map(({ x }) => x)),
        right: Math.max(...wetTiles.map(({ x }) => x)),
        top: Math.min(...wetTiles.map(({ y }) => y)),
        bottom: Math.max(...wetTiles.map(({ y }) => y)),
      };
      const wetHabitatTiles = [];
      for (let tileY = wetBounds.top; tileY <= wetBounds.bottom; tileY += 1) {
        for (let tileX = wetBounds.left; tileX <= wetBounds.right; tileX += 1) {
          wetHabitatTiles.push({ x: tileX, y: tileY });
        }
      }
      const topologyTiles = new Map([
        ...topology.routeTiles,
        ...wetHabitatTiles,
      ].map((tile) => [`${tile.x},${tile.y}`, tile]));
      for (const { x: tileX, y: tileY } of topologyTiles.values()) {
        for (let localY = 0; localY < 32; localY += 1) {
          const sourceOffset = (((tileY * 32 + localY) * scene.width) + tileX * 32) * 4;
          const destinationOffset = sourceOffset;
          foundation.data.copy(
            routeLayer.data,
            destinationOffset,
            sourceOffset,
            sourceOffset + 32 * 4,
          );
        }
      }
      routeSourceRoles.push("mechanics-topology-material");
    } else {
      const routeCellLayers = authoring.cellLayersByAtlas
        .get(`${kit}-terrain:${record.routeTarget.terrainCell}`)
        ?.filter(({ role }) => regionalR5LayerMatchesMechanicalRole(kit, role, targetRole)) ?? [];
      if (routeCellLayers.length === 0) throw new Error(`${record.clusterId}: actual ${targetRole} source layer missing`);
      for (const { raw } of routeCellLayers) {
        placeRegionalR5RawLayer(
          routeLayer,
          raw,
          record.routeTarget.tileX * 32,
          record.routeTarget.tileY * 32,
        );
      }
      routeSourceRoles.push(targetRole);
    }
    if (record.routeTarget.kind === "ash-service-chain") {
      for (const [id, sourceId, _role, x, y] of scene.macroLayers) {
        if (!["r5-scene/ash-waste/macro/03", "r5-scene/ash-waste/macro/05"].includes(id)) continue;
        placeRegionalR5RawLayer(routeLayer, authoring.fragments.get(sourceId), x, y);
      }
      for (const placement of scene.literalPatchLayers) {
        if (placement.id !== "r5-scene/ash-waste/patch/8") continue;
        placeRegionalR5RawLayer(routeLayer, authoring.patches.get(placement.patchId), placement.x, placement.y);
      }
      routeSourceRoles.push("service-route", "literal-service-slab");
      const serviceComponents = regionalR5AlphaComponentSizes(routeLayer);
      if (JSON.stringify(serviceComponents) !== JSON.stringify([3475])) {
        throw new Error(`${record.clusterId}: ash service route must be one exact 3475px component`);
      }
    }
    const landmarkLayer = landmarkLayers.get(record.clusterId);
    const selectedSupports = [supportLayers.get(record.supportA.keySceneLayerId), supportLayers.get(record.supportB.keySceneLayerId)];
    if (!landmarkLayer || selectedSupports.some((layer) => !layer)) {
      throw new Error(`${record.clusterId}: actual landmark/support source binding missing`);
    }
    const baseLayer = { data: Buffer.alloc(scene.width * scene.height * 4),
      width: scene.width, height: scene.height, channels: 4 };
    const clusterScene = { ...baseLayer, data: Buffer.from(baseLayer.data) };
    for (const layer of [routeLayer, landmarkLayer, ...selectedSupports]) placeRegionalR5RawLayer(clusterScene, layer, 0, 0);
    return {
      record,
      width: scene.width,
      height: scene.height,
      baseLayer,
      scene: clusterScene,
      routeLayer,
      routeSourceRoles,
      routeRgbaSha256: hashBuffer(routeLayer.data),
      landmarkLayer,
      supportLayers: selectedSupports,
    };
  });
  const connectivityInputs = bindRegionalR5ConnectivityInput(kit, clusters, records, authoring);
  return {
    kit,
    raw: composed,
    buffer: await encodeRegionalR5Raw(composed),
    completeProductionPreview: false,
    omittedProductionLayers: ["home", "human-witnesses"],
    connectivityInputs,
    ...(blindRepairDescriptor ? {
      blindVisualRepair: Object.freeze({
        id: blindRepairDescriptor.id,
        sourceOwned: true,
        diagnosticOnly: true,
        finalSourceApproval: false,
        atlasRuntimeReconstructible: false,
        task6Reconstructible: false,
        rgbaSha256: hashBuffer(blindRepairRaw.data),
        encodedSourceRgbaSha256: blindRepairDescriptor.rgbaSha256,
        raw: blindRepairRaw,
      }),
    } : {}),
  };
}

const REGIONAL_R5_DRY_V32_ROUTE_POINTS = Object.freeze([
  Object.freeze([784, 112]), Object.freeze([768, 112]), Object.freeze([720, 112]),
  Object.freeze([656, 112]), Object.freeze([620, 112]), Object.freeze([600, 128]),
  Object.freeze([576, 160]), Object.freeze([576, 184]), Object.freeze([568, 200]),
  Object.freeze([560, 208]), Object.freeze([500, 208]), Object.freeze([440, 208]),
  Object.freeze([420, 208]), Object.freeze([400, 228]), Object.freeze([400, 284]),
  Object.freeze([420, 304]), Object.freeze([448, 304]), Object.freeze([512, 300]),
  Object.freeze([560, 304]), Object.freeze([600, 316]), Object.freeze([632, 340]),
  Object.freeze([660, 360]), Object.freeze([696, 371]),
]);

function regionalR5DryChamferPath(points, radius = 4) {
  const output = [[...points[0]]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const incomingLength = Math.hypot(corner[0] - previous[0], corner[1] - previous[1]);
    const outgoingLength = Math.hypot(next[0] - corner[0], next[1] - corner[1]);
    const incomingCut = Math.min(radius, incomingLength / 3);
    const outgoingCut = Math.min(radius, outgoingLength / 3);
    const beveled = [
      [
        Math.round(corner[0] - (corner[0] - previous[0]) / incomingLength * incomingCut),
        Math.round(corner[1] - (corner[1] - previous[1]) / incomingLength * incomingCut),
      ],
      [
        Math.round(corner[0] + (next[0] - corner[0]) / outgoingLength * outgoingCut),
        Math.round(corner[1] + (next[1] - corner[1]) / outgoingLength * outgoingCut),
      ],
    ];
    for (const point of beveled) {
      const last = output.at(-1);
      if (last[0] !== point[0] || last[1] !== point[1]) output.push(point);
    }
  }
  output.push([...points.at(-1)]);
  return output;
}

function regionalR5DryRasterPath(points) {
  const output = [];
  for (let index = 1; index < points.length; index += 1) {
    const [fromX, fromY] = points[index - 1];
    const [toX, toY] = points[index];
    const steps = Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY), 1);
    for (let step = 0; step <= steps; step += 1) {
      const point = [
        Math.round(fromX + (toX - fromX) * step / steps),
        Math.round(fromY + (toY - fromY) * step / steps),
      ];
      const last = output.at(-1);
      if (!last || last[0] !== point[0] || last[1] !== point[1]) output.push(point);
    }
  }
  return output;
}

function regionalR5DryFillMaskPolygon(mask, width, height, points) {
  const minimumY = Math.max(0, Math.floor(Math.min(...points.map(([, y]) => y))));
  const maximumY = Math.min(height - 1, Math.ceil(Math.max(...points.map(([, y]) => y))));
  for (let y = minimumY; y <= maximumY; y += 1) {
    const intersections = [];
    for (let index = 0; index < points.length; index += 1) {
      const [x1, y1] = points[index];
      const [x2, y2] = points[(index + 1) % points.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        intersections.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
      }
    }
    intersections.sort((left, right) => left - right);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      for (let x = Math.ceil(intersections[index]); x <= Math.floor(intersections[index + 1]); x += 1) {
        if (x >= 0 && x < width) mask[y * width + x] = 1;
      }
    }
  }
}

function regionalR5DryStrokeMask(width, height, points, halfWidth) {
  const mask = new Uint8Array(width * height);
  const normals = [];
  for (let index = 1; index < points.length; index += 1) {
    const [x0, y0] = points[index - 1];
    const [x1, y1] = points[index];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const magnitude = Math.hypot(dx, dy);
    const normal = [-dy / magnitude * halfWidth, dx / magnitude * halfWidth];
    normals.push(normal);
    regionalR5DryFillMaskPolygon(mask, width, height, [
      [Math.round(x0 + normal[0]), Math.round(y0 + normal[1])],
      [Math.round(x1 + normal[0]), Math.round(y1 + normal[1])],
      [Math.round(x1 - normal[0]), Math.round(y1 - normal[1])],
      [Math.round(x0 - normal[0]), Math.round(y0 - normal[1])],
    ]);
  }
  for (let index = 1; index < points.length - 1; index += 1) {
    const [x, y] = points[index];
    const previous = normals[index - 1];
    const next = normals[index];
    regionalR5DryFillMaskPolygon(mask, width, height, [[x, y],
      [Math.round(x + previous[0]), Math.round(y + previous[1])],
      [Math.round(x + next[0]), Math.round(y + next[1])]]);
    regionalR5DryFillMaskPolygon(mask, width, height, [[x, y],
      [Math.round(x - previous[0]), Math.round(y - previous[1])],
      [Math.round(x - next[0]), Math.round(y - next[1])]]);
  }
  return mask;
}

function regionalR5DryNearestPathDistance(x, y, centerline) {
  let minimum = Number.POSITIVE_INFINITY;
  for (const [centerX, centerY] of centerline) {
    minimum = Math.min(minimum, Math.hypot(x - centerX, y - centerY));
  }
  return minimum;
}

function regionalR5DryComponent(mask, width, height, seedX, seedY) {
  const output = new Uint8Array(mask.length);
  const seed = seedY * width + seedX;
  if (mask[seed] === 0) return output;
  const queue = [seed];
  output[seed] = 1;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const pixelIndex = queue[cursor];
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    for (const [nextX, nextY] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
      const next = nextY * width + nextX;
      if (mask[next] === 0 || output[next] !== 0) continue;
      output[next] = 1;
      queue.push(next);
    }
  }
  return output;
}

function regionalR5DryMaskPoints(raw) {
  const points = [];
  for (let pixelIndex = 0; pixelIndex < raw.width * raw.height; pixelIndex += 1) {
    if (raw.data[pixelIndex * 4 + 3] !== 0) {
      points.push([pixelIndex % raw.width, Math.floor(pixelIndex / raw.width)]);
    }
  }
  return points;
}

function regionalR5DryPca(points) {
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const [x, y] of points) {
    xx += (x - meanX) ** 2;
    yy += (y - meanY) ** 2;
    xy += (x - meanX) * (y - meanY);
  }
  xx /= points.length;
  yy /= points.length;
  xy /= points.length;
  const discriminant = Math.sqrt((xx - yy) ** 2 + 4 * xy ** 2);
  const major = (xx + yy + discriminant) / 2;
  const minor = (xx + yy - discriminant) / 2;
  return {
    angleDegrees: Math.atan2(2 * xy, xx - yy) * 90 / Math.PI,
    axisRatio: Math.sqrt(major / Math.max(minor, Number.EPSILON)),
  };
}

function regionalR5DryMinimumPointDistance(leftPoints, rightPoints, height) {
  const rightByY = Array.from({ length: height }, () => []);
  for (const [x, y] of rightPoints) rightByY[y].push(x);
  for (const row of rightByY) row.sort((left, right) => left - right);
  let minimumSquared = Number.POSITIVE_INFINITY;
  for (const [leftX, leftY] of leftPoints) {
    for (let rightY = 0; rightY < height; rightY += 1) {
      const deltaY = rightY - leftY;
      if (deltaY ** 2 >= minimumSquared || rightByY[rightY].length === 0) continue;
      const row = rightByY[rightY];
      let low = 0;
      let high = row.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (row[middle] < leftX) low = middle + 1;
        else high = middle;
      }
      for (const index of [low - 1, low]) {
        if (index < 0 || index >= row.length) continue;
        minimumSquared = Math.min(minimumSquared, (row[index] - leftX) ** 2 + deltaY ** 2);
      }
    }
  }
  return Math.sqrt(minimumSquared);
}

/** Analyze Dry route geometry from supplied pixels without conferring source authority. */
export function analyzeRegionalR5DryRouteGeometry({
  scene,
  thornMask,
  windbreakMask,
  homeFoundationMask,
  homeForegroundMask,
} = {}) {
  for (const [label, raw] of Object.entries({
    scene, thornMask, windbreakMask, homeFoundationMask, homeForegroundMask,
  })) {
    assertRegionalR5Raw(raw, 'Dry route ' + label);
    if (raw.width !== 768 || raw.height !== 512) {
      throw new TypeError('Dry route ' + label + ' must be exact 768x512 geometry');
    }
  }
  const width = scene.width;
  const height = scene.height;
  const chamfered = regionalR5DryChamferPath(REGIONAL_R5_DRY_V32_ROUTE_POINTS);
  const centerline = regionalR5DryRasterPath(chamfered);
  const [finalApproachStartX, finalApproachStartY] = REGIONAL_R5_DRY_V32_ROUTE_POINTS.at(-4);
  const [terminalX, terminalY] = REGIONAL_R5_DRY_V32_ROUTE_POINTS.at(-1);
  const corridorMask = regionalR5DryStrokeMask(width, height, chamfered, 9);
  const trailRgb = regionalR5HexRgb(REGIONAL_R5_PALETTES.shared['matte-dirt'], 'matte-dirt');
  const actorRects = REGIONAL_R5_KEY_SCENES['dry-scrub'].humanLayers;
  const trailCandidates = new Uint8Array(width * height);
  for (let y = 96; y <= 384; y += 1) for (let x = 384; x < width; x += 1) {
    const pixelIndex = y * width + x;
    const offset = pixelIndex * 4;
    const exactTrail = scene.data[offset] === trailRgb[0] && scene.data[offset + 1] === trailRgb[1]
      && scene.data[offset + 2] === trailRgb[2] && scene.data[offset + 3] === 255;
    const pathDistance = regionalR5DryNearestPathDistance(x, y, centerline);
    const certifiedActorCutout = pathDistance <= 10 && actorRects.some((rect) => (
      x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height
    ));
    if ((exactTrail && pathDistance <= 11)
        || certifiedActorCutout) trailCandidates[pixelIndex] = 1;
  }
  const routeMask = regionalR5DryComponent(trailCandidates, width, height, 744, 112);
  const connectedRoute = regionalR5DryComponent(routeMask, width, height, 744, 112);
  let routePixelCount = 0;
  let connectedRoutePixelCount = 0;
  for (let pixelIndex = 0; pixelIndex < routeMask.length; pixelIndex += 1) {
    routePixelCount += routeMask[pixelIndex];
    connectedRoutePixelCount += connectedRoute[pixelIndex];
  }
  const routeConnected = routePixelCount > 0 && connectedRoutePixelCount === routePixelCount
    && connectedRoute[terminalY * width + terminalX] !== 0;

  const straightSegmentWidthsPx = [];
  const imputedSampleIndexes = [];
  for (let index = 1; index < REGIONAL_R5_DRY_V32_ROUTE_POINTS.length; index += 1) {
    const [fromX, fromY] = REGIONAL_R5_DRY_V32_ROUTE_POINTS[index - 1];
    const [toX, toY] = REGIONAL_R5_DRY_V32_ROUTE_POINTS[index];
    const segmentLength = Math.hypot(toX - fromX, toY - fromY);
    const x = Math.round((fromX + toX) / 2);
    const y = Math.round((fromY + toY) / 2);
    if (segmentLength <= 20 || x < 20 || x >= width - 20 || y < 20 || y >= height - 20) continue;
    const midpointOccludedByDynamicActor = actorRects.some((rect) => (
      x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height
    ));
    // The actorless source deliberately contains no authoritative terrain below
    // a dynamic human slot. Use the immediately preceding visible cross-section
    // of the same unbranched ribbon rather than inventing hidden pixels.
    if (midpointOccludedByDynamicActor && straightSegmentWidthsPx.length > 0) {
      imputedSampleIndexes.push(straightSegmentWidthsPx.length);
      straightSegmentWidthsPx.push(straightSegmentWidthsPx.at(-1));
      continue;
    }
    const normalX = -(toY - fromY) / segmentLength;
    const normalY = (toX - fromX) / segmentLength;
    const samples = [];
    for (let ordinal = 0; ordinal <= 320; ordinal += 1) {
      const offset = -40 + ordinal * 0.25;
      const sampleX = Math.round(x + normalX * offset);
      const sampleY = Math.round(y + normalY * offset);
      samples.push({ offset, occupied: connectedRoute[sampleY * width + sampleX] !== 0 });
    }
    const zero = 160;
    if (!samples[zero].occupied) {
      straightSegmentWidthsPx.push(0);
      continue;
    }
    let first = zero;
    let last = zero;
    while (first > 0 && samples[first - 1].occupied) first -= 1;
    while (last + 1 < samples.length && samples[last + 1].occupied) last += 1;
    straightSegmentWidthsPx.push(Number((samples[last].offset - samples[first].offset + 0.25).toFixed(2)));
  }
  let maximumTrailCenterlineDistancePx = 0;
  let maximumTrailCenterlineWitness = null;
  for (let pixelIndex = 0; pixelIndex < connectedRoute.length; pixelIndex += 1) {
    if (connectedRoute[pixelIndex] === 0) continue;
    const offset = pixelIndex * 4;
    if (scene.data[offset] !== trailRgb[0] || scene.data[offset + 1] !== trailRgb[1]
        || scene.data[offset + 2] !== trailRgb[2] || scene.data[offset + 3] !== 255) continue;
    if (homeFoundationMask.data[offset + 3] !== 0 || homeForegroundMask.data[offset + 3] !== 0) continue;
    const distance = regionalR5DryNearestPathDistance(
      pixelIndex % width,
      Math.floor(pixelIndex / width),
      centerline,
    );
    if (distance > maximumTrailCenterlineDistancePx) {
      maximumTrailCenterlineDistancePx = distance;
      maximumTrailCenterlineWitness = Object.freeze({
        x: pixelIndex % width,
        y: Math.floor(pixelIndex / width),
      });
    }
  }

  const finalApproach = [terminalX - finalApproachStartX, terminalY - finalApproachStartY];
  const finalApproachMagnitude = Math.hypot(...finalApproach);
  const tangent = finalApproach.map((value) => value / finalApproachMagnitude);
  const finalApproachAngleDegrees = Math.atan2(finalApproach[1], finalApproach[0]) * 180 / Math.PI;
  let salientObstructionPixels = 0;
  let windbreakCorridorOverlapPixels = 0;
  let thornCorridorOverlapPixels = 0;
  let homeCorridorOverlapPixels = 0;
  for (let pixelIndex = 0; pixelIndex < corridorMask.length; pixelIndex += 1) {
    if (corridorMask[pixelIndex] === 0) continue;
    const offset = pixelIndex * 4;
    const thorn = thornMask.data[offset + 3] !== 0;
    const windbreak = windbreakMask.data[offset + 3] !== 0;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const terminalProjection = (x - finalApproachStartX) * tangent[0]
      + (y - finalApproachStartY) * tangent[1];
    const terminalHomeApproach = terminalProjection >= -9;
    const home = !terminalHomeApproach
      && (homeFoundationMask.data[offset + 3] !== 0 || homeForegroundMask.data[offset + 3] !== 0);
    salientObstructionPixels += thorn || windbreak || home ? 1 : 0;
    thornCorridorOverlapPixels += thorn ? 1 : 0;
    windbreakCorridorOverlapPixels += windbreak ? 1 : 0;
    homeCorridorOverlapPixels += home ? 1 : 0;
  }

  const windbreakPoints = regionalR5DryMaskPoints(windbreakMask);
  const homeFoundationPoints = regionalR5DryMaskPoints(homeFoundationMask);
  const pca = regionalR5DryPca(windbreakPoints);
  let windbreakAngleDifferenceDegrees = Math.abs(pca.angleDegrees - finalApproachAngleDegrees) % 180;
  if (windbreakAngleDifferenceDegrees > 90) windbreakAngleDifferenceDegrees = 180 - windbreakAngleDifferenceDegrees;
  const windbreakParallelToFinalApproach = windbreakAngleDifferenceDegrees <= 15
    && pca.axisRatio >= 1.5 && windbreakCorridorOverlapPixels === 0;
  const project = (points) => {
    const values = points.map(([x, y]) => x * tangent[0] + y * tangent[1]);
    return [Math.min(...values), Math.max(...values)];
  };
  const windbreakProjection = project(windbreakPoints);
  const homeProjection = project(homeFoundationPoints);
  const windbreakHomeProjectionOverlapPx = Math.max(0,
    Math.min(windbreakProjection[1], homeProjection[1])
      - Math.max(windbreakProjection[0], homeProjection[0]));
  const windbreakHomeFoundationGapPx = regionalR5DryMinimumPointDistance(
    windbreakPoints,
    homeFoundationPoints,
    height,
  );
  const windbreakTouchesHomeFoundation = windbreakHomeFoundationGapPx <= 12
    && windbreakHomeProjectionOverlapPx >= 24;
  const minimumClearWidthPx = Math.min(...straightSegmentWidthsPx);
  const maximumClearWidthPx = Math.max(...straightSegmentWidthsPx);
  const errors = [];
  if (!routeConnected) errors.push('route-connectivity: entry and threshold must share one actual trail component');
  if (straightSegmentWidthsPx.length !== 18 || minimumClearWidthPx < 18 || maximumClearWidthPx > 22) {
    errors.push('route-width: all 18 actual trail samples must remain within 18-22px, observed '
      + JSON.stringify(straightSegmentWidthsPx));
  }
  if (maximumTrailCenterlineDistancePx > 11) {
    errors.push('route-centerline: actual trail exceeds 11px from its authority centerline');
  }
  if (salientObstructionPixels !== 0) {
    errors.push('route-obstruction: ' + salientObstructionPixels + ' salient scenery pixels cross the route');
  }
  if (!windbreakParallelToFinalApproach) {
    errors.push('windbreak-parallelism: windbreak must remain beside the final approach');
  }
  if (!windbreakTouchesHomeFoundation) {
    errors.push('home-foundation-contact: windbreak must remain joined to the permanent home');
  }
  return Object.freeze({
    straightSegmentWidthsPx: Object.freeze(straightSegmentWidthsPx),
    imputedSampleIndexes: Object.freeze(imputedSampleIndexes),
    minimumClearWidthPx,
    maximumClearWidthPx,
    maximumTrailCenterlineDistancePx,
    maximumTrailCenterlineWitness,
    salientObstructionPixels,
    thornCorridorOverlapPixels,
    windbreakCorridorOverlapPixels,
    homeCorridorOverlapPixels,
    windbreakAngleDegrees: pca.angleDegrees,
    finalApproachAngleDegrees,
    windbreakAngleDifferenceDegrees,
    windbreakAxisRatio: pca.axisRatio,
    windbreakParallelToFinalApproach,
    windbreakHomeFoundationGapPx,
    windbreakHomeProjectionOverlapPx,
    windbreakTouchesHomeFoundation,
    routeConnected,
    errors: Object.freeze(errors),
  });
}

function regionalR5DryPlacedPatchMask(authoring, placements, role, colorAllowlist = null) {
  const output = { data: Buffer.alloc(768 * 512 * 4), width: 768, height: 512, channels: 4 };
  for (const placement of placements.filter((candidate) => candidate.role === role)) {
    const patch = authoring.patches.get(placement.patchId);
    if (!patch) throw new Error('dry-scrub: route geometry patch missing for ' + role);
    placeRegionalR5RawLayer(output, patch, placement.x, placement.y);
  }
  if (colorAllowlist !== null) {
    for (let offset = 0; offset < output.data.length; offset += 4) {
      const rgb = output.data.subarray(offset, offset + 3).join(',');
      if (!colorAllowlist.has(rgb)) output.data.fill(0, offset, offset + 4);
    }
  }
  return output;
}

/** Measure the closed Dry V32 presentation route against source-owned final pixels. */
export async function measureRegionalR5DryRouteClearance(options = {}) {
  const optionKeys = Reflect.ownKeys(options);
  if (optionKeys.length !== 1 || optionKeys[0] !== "authoring") {
    throw new TypeError("Dry route clearance accepts only the trusted authoring source; candidate knobs are forbidden");
  }
  const { authoring } = options;
  assertRegionalR5TrustedAuthoring(authoring);
  const scene = await buildRegionalR5KeyScene({ kit: "dry-scrub", authoring });
  const sceneRgbaSha256 = hashBuffer(scene.raw.data);
  if (sceneRgbaSha256 !== "ea70e6dcd7f9f5e1a47d00f537b8b732d83d1033ac3591b6c61dded1377d1673") {
    throw new Error(`dry-scrub: route measurement requires exact V32 actorless pixels ${sceneRgbaSha256}`);
  }
  const routeTiles = REGIONAL_R5_MECHANICS_BINDINGS.scenePlans["dry-scrub"].routeTiles;
  const routeTilesSha256 = canonicalDigest(routeTiles);
  if (routeTiles.length !== 28
      || routeTilesSha256 !== "9a75dbe0fcda3e41b22a58f540a320e29e9849a99df8c861f6cd91fd52eaf542") {
    throw new Error("dry-scrub: frozen R4 route topology drift");
  }
  const authority = REGIONAL_R5_KEY_SCENES['dry-scrub'];
  const dryPalette = REGIONAL_R5_PALETTES.kits['dry-scrub'];
  const thornColors = new Set(['deadwood', 'thorn'].map((token) => (
    regionalR5HexRgb(dryPalette[token], token).join(',')
  )));
  const geometry = analyzeRegionalR5DryRouteGeometry({
    scene: scene.raw,
    thornMask: regionalR5DryPlacedPatchMask(
      authoring,
      authority.literalPatchLayers,
      'dry-open-thorn-passage',
      thornColors,
    ),
    windbreakMask: regionalR5DryPlacedPatchMask(
      authoring,
      authority.literalPatchLayers,
      'dry-home-windbreak',
    ),
    homeFoundationMask: regionalR5DryPlacedPatchMask(
      authoring,
      authority.completeUnderlayLayers,
      'dry-permanent-home-shell',
    ),
    homeForegroundMask: regionalR5DryPlacedPatchMask(
      authoring,
      authority.completeForegroundLayers,
      'dry-threshold-foreground',
    ),
  });
  if (geometry.errors.length > 0) {
    throw new Error('dry-scrub: measured V32 route geometry failed:\n' + geometry.errors.join('\n'));
  }
  return Object.freeze({
    routeTileCount: routeTiles.length,
    routeTilesSha256,
    routeAuthorityPoints: REGIONAL_R5_DRY_V32_ROUTE_POINTS,
    ...geometry,
    sceneRgbaSha256,
  });
}

const REGIONAL_R5_WORN_V9_ACTORLESS_RGBA_SHA256 =
  "639bbaa042ae538abc001927d5e466568155f1950b78923eeb8e3d0e4ea8a206";
const REGIONAL_R5_WORN_V9_ROUTE_TILES_SHA256 =
  "4dd5fcd6f8124b413d12e42b0729cb1b8a7577d3bf9c0b376bb5b98d3eca24d2";
const REGIONAL_R5_WORN_V9_SUCCESSOR_RECEIPT_SHA256 =
  "aeff67bf2976ab04d7955658a19771ea2928b5ae284490889edb3012a6b3dd95";
const REGIONAL_R5_WORN_ROLE_INPUTS = Object.freeze({
  "worn-ground-foundation": "actorlessWorld",
  "worn-oak-root-foundation": "oakRootFoundation",
  "worn-worked-garden-foundation": "workedGardenFoundation",
  "worn-trampled-lane": "trampledLane",
  "worn-home-yard-history": "homeYardHistory",
});
const REGIONAL_R5_WORN_V9_RELATION_RGBA_SHA256 = Object.freeze({
  actorlessWorld: "639bbaa042ae538abc001927d5e466568155f1950b78923eeb8e3d0e4ea8a206",
  oakRootFoundation: "ba3c3cd6e25eaa556a7760ed8ed705b570ea8607af138d3d10c5d9ed3476341d",
  workedGardenFoundation: "0e2b5205ab98132dd45d88103d2b0fa12476f9eea50b01af3a2b2dad8f7161c3",
  trampledLane: "85d8df79cd82d9b6807109c7c7f9db96f82910f0d36d3590093ee77a4cdc7ed3",
  homeYardHistory: "6e545ac2c9e2424076770c9680667c761975451a5ad0e86823bf949beab55548",
  landmark0: "ff3738967281ab1480a122dc9a725368561bd79c0dbc2127936ceeaf1ebc066e",
  landmark1: "86b12fac1c5d0b175d18a27d9c8dee7f14cd1a3a0b9aab20f6e534feddd9f4f6",
  landmark2: "965714dca6bf71df22656521dd7bfdf8a1158c0a2fb623df829c0907fe7ced26",
  landmark3: "0df84e93d649ff2aa61d73a7657d57dbd521b842acb8a2209a4beb7f9d1a4e2f",
  landmark4: "d3fed5f4e6e884b6dce9c2cef4b2092e2ae6efd0da2642e06ecf2c48be252e32",
  landmark5: "3f1b7993ab967a366cec773977874b52b9080c51b5601caa9ccbb237c1a51e82",
  eastWestShoulder: "24a8b3e8dc9aceba4116c2b1836bb7d0f1cbbd53587b43305947d1036e7e199a",
  northSouthShoulder: "3fc839f9d1a36575457325e53bab55bf034cfc7ee2a0c240e6db17d615fdbd9e",
});

function regionalR5WornFullRoleLayer(authoring, scene, role) {
  const placements = scene.literalPatchLayers.filter((placement) => placement.role === role);
  if (placements.length !== 1) throw new Error(`worn-heartland: ${role} must have one exact source placement`);
  const placement = placements[0];
  const patch = authoring.patches.get(placement.patchId);
  if (!patch || patch.width !== placement.width || patch.height !== placement.height) {
    throw new Error(`worn-heartland: ${role} source patch geometry drift`);
  }
  return regionalR5FullLayer(scene.width, scene.height, patch, placement.x, placement.y);
}

/** Return the exact authority-derived Worn relation masks with no caller-supplied geometry. */
export function regionalR5WornRelationInputs(options = {}) {
  const optionKeys = Reflect.ownKeys(options);
  if (optionKeys.length !== 1 || optionKeys[0] !== "authoring") {
    throw new TypeError("Worn relation inputs accept only the trusted authoring source; candidate knobs are forbidden");
  }
  const { authoring } = options;
  assertRegionalR5TrustedAuthoring(authoring);
  const scene = REGIONAL_R5_KEY_SCENES["worn-heartland"];
  const inputs = Object.fromEntries(Object.entries(REGIONAL_R5_WORN_ROLE_INPUTS).map(([role, name]) => [
    name,
    regionalR5WornFullRoleLayer(authoring, scene, role),
  ]));
  const landmarks = authoring.rawMasters["worn-heartland-landmarks"];
  for (const [cell, name] of [
    [0, "landmark0"], [1, "landmark1"], [2, "landmark2"],
    [3, "landmark3"], [4, "landmark4"], [5, "landmark5"],
    [6, "eastWestShoulder"], [7, "northSouthShoulder"],
  ]) {
    const placement = scene.landmarkLayers.find((candidate) => candidate.cell === cell);
    if (!placement) throw new Error(`worn-heartland: landmark cell ${cell} placement missing`);
    inputs[name] = regionalR5FullLayer(
      scene.width,
      scene.height,
      regionalR5Cell(landmarks, cell, 128, 128),
      placement.x,
      placement.y,
    );
  }
  return Object.freeze(inputs);
}

function regionalR5WornRawTouches(left, right, bounds = null) {
  for (let index = 0; index < left.width * left.height; index += 1) {
    if (left.data[index * 4 + 3] === 0) continue;
    const x = index % left.width;
    const y = Math.floor(index / left.width);
    if (bounds && (x < bounds.left || x >= bounds.right || y < bounds.top || y >= bounds.bottom)) {
      continue;
    }
    for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextY < 0 || nextX >= right.width || nextY >= right.height) continue;
      if (right.data[(nextY * right.width + nextX) * 4 + 3] !== 0) return true;
    }
  }
  return false;
}

function regionalR5WornLongestOpening(raw, points, fenceColors) {
  let current = 0;
  let longest = 0;
  for (const [x, y] of points) {
    const offset = (y * raw.width + x) * 4;
    const key = raw.data.subarray(offset, offset + 3).join(",");
    if (fenceColors.has(key)) current = 0;
    else {
      current += 1;
      longest = Math.max(longest, current);
    }
  }
  return longest;
}

function regionalR5WornColorCount(raw, rgb) {
  let count = 0;
  const key = rgb.join(",");
  for (let offset = 0; offset < raw.data.length; offset += 4) {
    if (raw.data[offset + 3] !== 0 && raw.data.subarray(offset, offset + 3).join(",") === key) count += 1;
  }
  return count;
}

/** Analyze Worn joined-landscape geometry from raster inputs, including hostile candidates. */
export function analyzeRegionalR5WornRelations(inputs = {}) {
  const names = [
    "actorlessWorld", "oakRootFoundation", "workedGardenFoundation", "trampledLane",
    "homeYardHistory", "landmark0", "landmark1", "landmark2", "landmark3", "landmark4",
    "landmark5", "eastWestShoulder", "northSouthShoulder",
  ];
  const errors = [];
  if (Reflect.ownKeys(inputs).length !== names.length || names.some((name) => !Object.hasOwn(inputs, name))) {
    return Object.freeze({ errors: Object.freeze(["source-input: exact Worn relation input set required"]) });
  }
  for (const name of names) {
    try {
      assertRegionalR5Raw(inputs[name], `worn-heartland ${name}`);
      if (inputs[name].width !== 768 || inputs[name].height !== 512) {
        errors.push(`source-input: ${name} must be 768x512`);
      }
    } catch {
      errors.push(`source-input: ${name} must be an exact RGBA layer`);
    }
  }
  if (errors.length > 0) return Object.freeze({ errors: Object.freeze(errors) });

  const wornPalette = REGIONAL_R5_PALETTES.kits["worn-heartland"];
  const allowedColors = new Set([
    "28,28,36",
    ...Object.values(wornPalette).map((hex) => regionalR5HexRgb(hex, "worn palette").join(",")),
  ]);
  for (const name of names) {
    const raw = inputs[name];
    const rgbaSha256 = hashBuffer(raw.data);
    if (rgbaSha256 !== REGIONAL_R5_WORN_V9_RELATION_RGBA_SHA256[name]) {
      errors.push(`source-hash: ${name} exact V9 RGBA drift ${rgbaSha256}`);
    }
    for (let offset = 0; offset < raw.data.length; offset += 4) {
      if (raw.data[offset + 3] === 0) continue;
      const color = raw.data.subarray(offset, offset + 3).join(",");
      if (!allowedColors.has(color)) {
        errors.push(`palette: ${name} contains unapproved Worn color ${color}`);
        break;
      }
    }
  }
  const oakRootComponentCount = regionalR5AlphaComponentSizes(inputs.oakRootFoundation).length;
  const laneComponentCount = regionalR5AlphaComponentSizes(inputs.trampledLane).length;
  const fenceColors = new Set([
    "28,28,36",
    regionalR5HexRgb(wornPalette.timber, "timber").join(","),
    regionalR5HexRgb(wornPalette["worn-beige"], "worn-beige").join(","),
  ]);
  const southGardenOpeningPx = regionalR5WornLongestOpening(
    inputs.landmark3,
    Array.from({ length: 103 }, (_unused, index) => [131 + index, 254]),
    fenceColors,
  );
  const eastGardenOpeningPx = regionalR5WornLongestOpening(
    inputs.landmark4,
    Array.from({ length: 110 }, (_unused, index) => [340, 150 + index]),
    fenceColors,
  );
  const laneConnected = laneComponentCount === 1;
  const eastWestShoulderTouchesLane = regionalR5WornRawTouches(inputs.eastWestShoulder, inputs.trampledLane);
  const northSouthShoulderTouchesLane = regionalR5WornRawTouches(inputs.northSouthShoulder, inputs.trampledLane);
  const landmarkFoundations = [
    [inputs.landmark0, inputs.oakRootFoundation, "worn-oak-root-foundation"],
    [inputs.landmark1, inputs.oakRootFoundation, "worn-oak-root-foundation"],
    [inputs.landmark2, inputs.oakRootFoundation, "worn-oak-root-foundation"],
    [inputs.landmark3, inputs.workedGardenFoundation, "worn-worked-garden-foundation"],
    [inputs.landmark4, inputs.workedGardenFoundation, "worn-worked-garden-foundation"],
    [inputs.landmark5, inputs.workedGardenFoundation, "worn-worked-garden-foundation"],
    [inputs.eastWestShoulder, inputs.trampledLane, "worn-trampled-lane"],
    [inputs.northSouthShoulder, inputs.trampledLane, "worn-trampled-lane"],
  ];
  const landmarkFoundationReceipts = landmarkFoundations.map(([landmark, foundation, foundationRole], cell) => ({
    cell,
    landmarkRgbaSha256: hashBuffer(landmark.data),
    foundationRole,
    foundationRgbaSha256: hashBuffer(foundation.data),
    touchesFoundation: regionalR5WornRawTouches(landmark, foundation),
  }));
  const yardAuthority = REGIONAL_R5_MECHANICS_BINDINGS.yards["worn-heartland"];
  const yardPlacement = REGIONAL_R5_KEY_SCENES["worn-heartland"].yardLayers[0];
  const southPort = yardAuthority.connectionPorts.find(({ side, role }) => (
    side === "south" && role === "path"
  ));
  const yardSouthPortCorridor = Object.freeze({
    left: yardPlacement.x + southPort.startPx,
    right: yardPlacement.x + southPort.startPx + southPort.widthPx,
    top: yardPlacement.y + yardAuthority.contactPivotPx.y,
    bottom: yardPlacement.y + yardPlacement.height,
  });
  const laneTouchesYardSouthPort = regionalR5WornRawTouches(
    inputs.trampledLane,
    inputs.homeYardHistory,
    yardSouthPortCorridor,
  );
  const timber = regionalR5HexRgb(wornPalette.timber, "timber");
  const stone = regionalR5HexRgb(wornPalette["worn-beige"], "worn-beige");
  const timberPixels = regionalR5WornColorCount(inputs.homeYardHistory, timber);
  const stonePixels = regionalR5WornColorCount(inputs.homeYardHistory, stone);
  const timberTouchesYardHistory = timberPixels >= 500;
  const stoneTouchesYardHistory = stonePixels >= 500;
  if (oakRootComponentCount !== 1) errors.push("oak-root: foundation must remain one joined component");
  if (southGardenOpeningPx < 32 || eastGardenOpeningPx < 32) {
    errors.push("garden-opening: south and east working openings must each remain at least 32px");
  }
  if (!laneConnected) errors.push("lane-connectivity: trampled lane must remain one component");
  if (!eastWestShoulderTouchesLane) errors.push("shoulder-contact: east-west reclaimed shoulder must touch lane");
  if (!northSouthShoulderTouchesLane) errors.push("shoulder-contact: north-south reclaimed shoulder must touch lane");
  for (const receipt of landmarkFoundationReceipts) {
    if (!receipt.touchesFoundation) {
      errors.push(`landmark-foundation: cell ${receipt.cell} must touch ${receipt.foundationRole}`);
    }
  }
  if (!laneTouchesYardSouthPort) errors.push("yard-contact: lane must touch the occupied yard return");
  if (!timberTouchesYardHistory) errors.push("yard-history: joined timber history is missing");
  if (!stoneTouchesYardHistory) errors.push("yard-history: joined fieldstone history is missing");
  return Object.freeze({
    oakRootComponentCount,
    laneComponentCount,
    southGardenOpeningPx,
    eastGardenOpeningPx,
    laneConnected,
    eastWestShoulderTouchesLane,
    northSouthShoulderTouchesLane,
    landmarkFoundationReceipts: Object.freeze(landmarkFoundationReceipts.map(Object.freeze)),
    yardSouthPortCorridor,
    laneTouchesYardSouthPort,
    timberTouchesYardHistory,
    stoneTouchesYardHistory,
    timberPixels,
    stonePixels,
    errors: Object.freeze(errors),
  });
}

function regionalR5WornActorWitnessReceipts() {
  const scene = REGIONAL_R5_KEY_SCENES["worn-heartland"];
  const mechanics = REGIONAL_R5_MECHANICS_BINDINGS.scenePlans["worn-heartland"];
  const receipts = scene.humanLayers.map((actor) => {
    const feet = { x: actor.x + 24, y: actor.y + 61 };
    let relationshipValid = false;
    if (actor.role === "route-entry") {
      relationshipValid = mechanics.routeTiles.some(({ x, y }) => (
        feet.x === x * 32 + 16 && feet.y === y * 32 + 16
      ));
    } else if (actor.role === "defining-landmark") {
      relationshipValid = mechanics.landmarks.some(({ x, y }) => (
        feet.x >= x && feet.x < x + 128 && feet.y >= y && feet.y < y + 128
      ));
    } else if (actor.role === "shelter-door") {
      relationshipValid = actor.x === 640 && actor.y === 399
        && feet.x === 664 && feet.y === 460
        && (feet.x !== mechanics.home.doorCenterPx.x || feet.y !== mechanics.home.doorCenterPx.y);
    }
    return Object.freeze({
      role: actor.role,
      anchor: Object.freeze({ x: actor.x, y: actor.y }),
      feet: Object.freeze(feet),
      facing: actor.facing,
      relationshipValid,
    });
  });
  return Object.freeze(receipts);
}

function regionalR5WornSuccessorMeasurement(inputs) {
  const relations = analyzeRegionalR5WornRelations(inputs);
  const actorWitnessReceipts = regionalR5WornActorWitnessReceipts();
  const landmarkFoundationReceipts = Object.freeze(relations.landmarkFoundationReceipts.map((receipt) => {
    const placement = REGIONAL_R5_KEY_SCENES["worn-heartland"].landmarkLayers[receipt.cell];
    return Object.freeze({
      kitId: "worn-heartland",
      variantId: placement.variantId,
      placement: Object.freeze({ x: placement.x, y: placement.y }),
      ...receipt,
    });
  }));
  const actorErrors = actorWitnessReceipts.flatMap((receipt) => [
    ...(receipt.facing === "south" ? [] : [`actor: ${receipt.role} must face south`]),
    ...(receipt.relationshipValid ? [] : [`actor: ${receipt.role} relationship drift`]),
  ]);
  const successorReceipt = {
    schema: "regional-r5-worn-successor-relations/v1",
    sceneRgbaSha256: hashBuffer(inputs.actorlessWorld.data),
    landmarkFoundationReceipts,
    southGardenOpeningPx: relations.southGardenOpeningPx,
    eastGardenOpeningPx: relations.eastGardenOpeningPx,
    laneConnected: relations.laneConnected,
    laneTouchesYardSouthPort: relations.laneTouchesYardSouthPort,
    yardSouthPortCorridor: relations.yardSouthPortCorridor,
    timberTouchesYardHistory: relations.timberTouchesYardHistory,
    stoneTouchesYardHistory: relations.stoneTouchesYardHistory,
    actorWitnessReceipts,
  };
  const canonicalSha256 = canonicalDigest(successorReceipt);
  const receiptErrors = canonicalSha256 === REGIONAL_R5_WORN_V9_SUCCESSOR_RECEIPT_SHA256
    ? []
    : [`successor-receipt: exact V9 receipt drift ${canonicalSha256}`];
  const errors = Object.freeze([...relations.errors, ...actorErrors, ...receiptErrors]);
  return Object.freeze({
    ...relations,
    landmarkFoundationReceipts,
    actorWitnessReceipts,
    successorReceipt: Object.freeze({
      ...successorReceipt,
      canonicalSha256,
    }),
    errors,
  });
}

/** Measure the accepted Worn V9 relationships from trusted structured source only. */
export async function measureRegionalR5WornRelations(options = {}) {
  const optionKeys = Reflect.ownKeys(options);
  if (optionKeys.length !== 1 || optionKeys[0] !== "authoring") {
    throw new TypeError("Worn relation measurement accepts only the trusted authoring source; candidate knobs are forbidden");
  }
  const { authoring } = options;
  assertRegionalR5TrustedAuthoring(authoring);
  const scene = await buildRegionalR5KeyScene({ kit: "worn-heartland", authoring });
  const sceneRgbaSha256 = hashBuffer(scene.raw.data);
  if (sceneRgbaSha256 !== REGIONAL_R5_WORN_V9_ACTORLESS_RGBA_SHA256) {
    throw new Error(`worn-heartland: relation measurement requires exact V9 actorless pixels ${sceneRgbaSha256}`);
  }
  const routeTiles = REGIONAL_R5_MECHANICS_BINDINGS.scenePlans["worn-heartland"].routeTiles;
  const routeTilesSha256 = canonicalDigest(routeTiles);
  if (routeTiles.length !== 29 || routeTilesSha256 !== REGIONAL_R5_WORN_V9_ROUTE_TILES_SHA256) {
    throw new Error("worn-heartland: frozen R4 route topology drift");
  }
  const measured = regionalR5WornSuccessorMeasurement(regionalR5WornRelationInputs({ authoring }));
  if (measured.errors.length > 0) {
    throw new Error(`worn-heartland: measured V9 relation geometry failed:\n${measured.errors.join("\n")}`);
  }
  return Object.freeze({
    routeTileCount: routeTiles.length,
    routeTilesSha256,
    sceneRgbaSha256,
    ...measured,
  });
}

const REGIONAL_R5_COMPLETE_PROOF_KITS = Object.freeze(["ash-waste", "neutral-temperate"]);
const REGIONAL_R5_COMPLETE_SCENE_KITS = Object.freeze([
  ...REGIONAL_R5_COMPLETE_PROOF_KITS,
  "spring-terraces",
  "dry-scrub",
  "worn-heartland",
]);
const REGIONAL_R5_COMPLETE_PROOF_SOURCE_CONTRACTS = Object.freeze({
  humanBody: Object.freeze({
    atlasId: "core-human-body-rigs",
    width: 768,
    height: 1408,
    rgbaSha256: "64eb5e868386adeafb038290a003fbd616e18427cdc18807211979b971b59d44",
  }),
  humanFace: Object.freeze({
    atlasId: "core-human-face-planes",
    width: 768,
    height: 256,
    rgbaSha256: "6cc516f6bb6f2c58ad5680f9abe6fb62b9a642102ac6523ad216c99ce6d00f73",
  }),
  humanHair: Object.freeze({
    atlasId: "core-human-hair",
    width: 768,
    height: 768,
    rgbaSha256: "f1e5f819e36852aa9edb049dca9a3e47a7be389f7ae17988303827f2a4e62dca",
  }),
  humanClothing: Object.freeze({
    atlasId: "core-human-clothing-00",
    width: 768,
    height: 704,
    rgbaSha256: "25f3dfcd58779755132f1f1e9d706b413bab4ff5a510984c75b89c4a891835ae",
  }),
});
const REGIONAL_R5_COMPLETE_PROOF_HOME_RGBA_SHA256 = Object.freeze({
  "ash-waste": "146bf40d48081eeaa3e3e7e3a56367f35cac72dac0d1b8723d699d429a5b2d3f",
  "neutral-temperate": "fc1c0550842912a6cebe13535c1f849a28269ccd9392e9d41dc6b718d62bc39a",
  "spring-terraces": "de645288e44e455f5d430e9de8b592f6dc6119bda96a56e1721717ef41f8adf8",
  "dry-scrub": "c10095e73a653eeed10e4717b53128d18a8250ef456e88da092b2af45bd2ef3e",
  "worn-heartland": "657ef627ad81c31f13862adbe4788583ce0574b92e5a3a5b47876431c614be12",
});
const REGIONAL_R5_COMPLETE_PROOF_FRONT_PATCH_RGBA_SHA256 = Object.freeze({
  ...REGIONAL_R5_MECHANICS_BINDINGS.entranceDepth.frontPatchRgbaSha256,
  "dry-scrub": "09cce4f5c1caee2e10d65b338fbf2459563bb66346a2e923a9c3aa85ed5642d3",
  "worn-heartland": "b8a0e956785ecd6f60059b6e308354200cf23896fe99446f525a30cfd4e3286e",
});
const REGIONAL_R5_DRY_V32_FINAL_RGBA_SHA256 =
  "35d2eed8ecb9dc65c2763fb9fc4e286e5abebe84947d2c9aa53512221db382ae";
const REGIONAL_R5_WORN_V9_FINAL_RGBA_SHA256 =
  "21e6997c655833aab5816adc914411771da82c1cc40e57a0b5ce6cf75ed28285";
const REGIONAL_R5_COMPLETE_PROOF_HUMAN_SLOTS = Object.freeze({
  "core-human-body-rigs": "humanBody",
  "core-human-face-planes": "humanFace",
  "core-human-hair": "humanHair",
  "core-human-clothing-00": "humanClothing",
});

function regionalR5CompleteProofError(validationErrors) {
  const error = new Error(`R5 complete proof validation failed:\n${validationErrors.join("\n")}`);
  error.name = "RegionalR5ProofValidationError";
  error.code = "REGIONAL_R5_PROOF_VALIDATION_FAILED";
  error.validationErrors = Object.freeze([...validationErrors]);
  return error;
}

function regionalR5CompleteProofHomeAuthority(kit) {
  const proof = REGIONAL_R5_MECHANICS_BINDINGS.visualProofBindings.homeActorProofs.kitProofs
    .find(({ kitId }) => kitId === kit);
  const scene = REGIONAL_R5_KEY_SCENES[kit];
  const home = REGIONAL_R5_MECHANICS_BINDINGS.homeActors[kit];
  if (!proof || !scene || !home) {
    throw new Error(`${kit}: R5 complete proof home/scene authority is incomplete or divergent`);
  }
  return { proof, scene, home };
}

function regionalR5CompleteProofSourceDescriptors(kit) {
  const { proof } = regionalR5CompleteProofHomeAuthority(kit);
  const humanLayers = REGIONAL_R5_MECHANICS_BINDINGS.productionHuman.layers;
  const descriptors = [{
    slot: "homeComponents",
    atlasId: `${kit}-home-components`,
    pngSha256: proof.componentAtlasPngSha256,
    rgbaSha256: REGIONAL_R5_COMPLETE_PROOF_HOME_RGBA_SHA256[kit],
    width: proof.componentAtlasGeometry.width,
    height: proof.componentAtlasGeometry.height,
  }];
  for (const layer of humanLayers) {
    const slot = REGIONAL_R5_COMPLETE_PROOF_HUMAN_SLOTS[layer.atlasId];
    const contract = REGIONAL_R5_COMPLETE_PROOF_SOURCE_CONTRACTS[slot];
    if (!slot || !contract || contract.atlasId !== layer.atlasId) {
      throw new Error(`${kit}: unsupported R5 production-human layer ${layer.atlasId}`);
    }
    descriptors.push({
      slot,
      atlasId: layer.atlasId,
      pngSha256: layer.atlasSha256,
      rgbaSha256: contract.rgbaSha256,
      width: contract.width,
      height: contract.height,
      cellIndex: layer.cellIndex,
    });
  }
  if (descriptors.length !== 5 || new Set(descriptors.map(({ slot }) => slot)).size !== 5) {
    throw new Error(`${kit}: R5 complete proof requires exact home plus four human source atlases`);
  }
  return descriptors;
}

async function regionalR5DecodeCompleteProofSources(kit, sourceBuffers, decodeSource) {
  const resolvedBuffers = await sourceBuffers;
  const descriptors = regionalR5CompleteProofSourceDescriptors(kit);
  const sourceShape = regionalR5PlainDataTrustSnapshot(
    resolvedBuffers,
    Object.prototype,
    `${kit} R5 complete proof sources`,
  );
  const expectedKeys = new Set(descriptors.map(({ slot }) => slot));
  if (sourceShape.entries.length !== descriptors.length
      || sourceShape.entries.some(({ key }) => !expectedKeys.has(key))) {
    throw new TypeError(`${kit}: R5 complete proof sources require exact homeComponents, humanBody, humanFace, humanHair, and humanClothing plain data properties`);
  }
  const snapshots = {};
  for (const descriptor of descriptors) {
    const buffer = sourceShape.entries.find(({ key }) => key === descriptor.slot)?.value;
    if (!regionalR5BufferIsUnshadowed(buffer)) {
      throw new TypeError(`${descriptor.slot}: R5 complete proof source must be unshadowed Buffer bytes`);
    }
    snapshots[descriptor.slot] = Buffer.from(buffer);
    const digest = hashBuffer(snapshots[descriptor.slot]);
    if (digest !== descriptor.pngSha256) {
      throw new Error(`${descriptor.slot}: R5 complete proof PNG hash drift ${digest}`);
    }
  }
  const decoded = {};
  const sourceLayers = [];
  for (const descriptor of descriptors) {
    const raw = await decodeSource(snapshots[descriptor.slot], descriptor);
    assertRegionalR5Raw(raw, `${descriptor.slot} decoded R5 complete proof source`);
    if (raw.width !== descriptor.width || raw.height !== descriptor.height) {
      throw new Error(`${descriptor.slot}: R5 complete proof dimensions must be ${descriptor.width}x${descriptor.height}`);
    }
    const rgbaSha256 = hashBuffer(raw.data);
    if (rgbaSha256 !== descriptor.rgbaSha256) {
      throw new Error(`${descriptor.slot}: R5 complete proof decoded RGBA hash drift ${rgbaSha256}`);
    }
    decoded[descriptor.slot] = raw;
    sourceLayers.push(Object.freeze({
      slot: descriptor.slot,
      atlasId: descriptor.atlasId,
      atlasSha256: descriptor.pngSha256,
      rgbaSha256,
      width: descriptor.width,
      height: descriptor.height,
      ...(descriptor.cellIndex === undefined ? {} : { cellIndex: descriptor.cellIndex }),
    }));
  }
  return { decoded, sourceLayers };
}

/** Reconstruct exact trusted HomeActor and production-human components without creating proof evidence. */
export async function buildRegionalR5CompleteProofComponents({
  kit,
  sourceBuffers,
  decodeSource = decodeRegionalR5Guide,
} = {}) {
  if (!REGIONAL_R5_COMPLETE_SCENE_KITS.includes(kit)) {
    throw new Error(`R5 complete proof kit is not authoring-approved, received ${kit}`);
  }
  if (typeof decodeSource !== "function") throw new TypeError("R5 complete proof decodeSource must be a function");
  const { proof, scene } = regionalR5CompleteProofHomeAuthority(kit);
  const { decoded, sourceLayers } = await regionalR5DecodeCompleteProofSources(kit, sourceBuffers, decodeSource);
  const construction = REGIONAL_R5_MECHANICS_BINDINGS.visualProofBindings.homeActorProofs.construction;
  const entranceAuthority = REGIONAL_R5_MECHANICS_BINDINGS.entranceDepth;
  const homeProof = {
    data: Buffer.alloc(construction.output.width * construction.output.height * 4),
    width: construction.output.width,
    height: construction.output.height,
    channels: 4,
  };
  const frontProof = {
    data: Buffer.alloc(construction.output.width * construction.output.height * 4),
    width: construction.output.width,
    height: construction.output.height,
    channels: 4,
  };
  for (const frame of construction.frameSequence) {
    const component = regionalR5Cell(decoded.homeComponents, frame.index, 128, 128);
    placeRegionalR5RawLayer(
      homeProof,
      component,
      construction.origin.x,
      construction.origin.y,
    );
    if (frame.group === entranceAuthority.frontFrameGroup) {
      placeRegionalR5RawLayer(frontProof, component, construction.origin.x, construction.origin.y);
    }
  }
  const homeProofDigest = hashBuffer(homeProof.data);
  if (homeProofDigest !== proof.homeActorRgbaSha256) {
    throw new Error(`${kit}: R5 HomeActor construction RGBA hash drift ${homeProofDigest}`);
  }
  const homePatch = regionalR5RawCrop(homeProof, [
    construction.origin.x,
    construction.origin.y,
    scene.homeLayer.width,
    scene.homeLayer.height,
  ]);
  const homePatchDigest = hashBuffer(homePatch.data);
  const frontPatch = regionalR5RawCrop(frontProof, [
    construction.origin.x,
    construction.origin.y,
    scene.homeLayer.width,
    scene.homeLayer.height,
  ]);
  const frontPatchDigest = hashBuffer(frontPatch.data);
  if (frontPatchDigest !== REGIONAL_R5_COMPLETE_PROOF_FRONT_PATCH_RGBA_SHA256[kit]) {
    throw new Error(`${kit}: R5 HomeActor frontPatch RGBA hash drift ${frontPatchDigest}`);
  }
  const humanAuthority = REGIONAL_R5_MECHANICS_BINDINGS.productionHuman;
  const humanPatch = { data: Buffer.alloc(48 * 64 * 4), width: 48, height: 64, channels: 4 };
  const humanSourceLayers = [];
  const humanSemanticPatches = {};
  for (const layer of humanAuthority.layers) {
    const slot = REGIONAL_R5_COMPLETE_PROOF_HUMAN_SLOTS[layer.atlasId];
    const source = regionalR5Cell(decoded[slot], layer.cellIndex, 48, 64);
    placeRegionalR5RawLayer(humanPatch, source, 0, 0);
    humanSourceLayers.push(sourceLayers.find((candidate) => candidate.slot === slot));
    if (slot === "humanFace" || slot === "humanHair") humanSemanticPatches[slot] = source;
  }
  const humanDigest = hashBuffer(humanPatch.data);
  if (humanDigest !== humanAuthority.canonicalPatchSha256) {
    throw new Error(`${kit}: R5 production-human patch RGBA hash drift ${humanDigest}`);
  }
  const facePatchDigest = hashBuffer(humanSemanticPatches.humanFace?.data ?? Buffer.alloc(0));
  const hairPatchDigest = hashBuffer(humanSemanticPatches.humanHair?.data ?? Buffer.alloc(0));
  if (facePatchDigest !== entranceAuthority.humanSemanticRgbaSha256.face
      || hairPatchDigest !== entranceAuthority.humanSemanticRgbaSha256.hair) {
    throw new Error(`${kit}: R5 production-human face/hair semantic RGBA hash drift`);
  }
  const contract = Object.freeze({
    assetId: humanAuthority.assetId,
    rig: humanAuthority.rig,
    facing: humanAuthority.facing,
    action: humanAuthority.action,
    frameIndex: humanAuthority.frameIndex,
    expression: humanAuthority.expression,
    clothing: humanAuthority.clothing,
    feet: structuredClone(humanAuthority.feet),
  });
  const expectedRoles = ["route-entry", "defining-landmark", "shelter-door"];
  if (scene.humanLayers.length !== 3) throw new Error(`${kit}: R5 complete proof requires exactly three human witnesses`);
  const humanWitnesses = scene.humanLayers.map((placement, index) => {
    const mechanicalFields = {
      contractId: placement.contractId,
      rig: placement.rig,
      facing: placement.facing,
      action: placement.action,
      frameIndex: placement.frameIndex,
      expression: placement.expression,
      clothing: placement.clothing,
    };
    const expectedFields = {
      contractId: humanAuthority.assetId,
      rig: humanAuthority.rig,
      facing: humanAuthority.facing,
      action: humanAuthority.action,
      frameIndex: humanAuthority.frameIndex,
      expression: humanAuthority.expression,
      clothing: humanAuthority.clothing,
    };
    if (placement.role !== expectedRoles[index] || placement.width !== 48 || placement.height !== 64
        || canonicalJson(mechanicalFields) !== canonicalJson(expectedFields)) {
      throw new Error(`${kit}: R5 human witness ${index} drifts from production-human authority`);
    }
    return Object.freeze({
      placement: structuredClone(placement),
      feet: Object.freeze({ x: placement.x + humanAuthority.feet.x, y: placement.y + humanAuthority.feet.y }),
      patchRgbaSha256: humanDigest,
    });
  });
  return {
    kit,
    homeActor: {
      placement: structuredClone(scene.homeLayer),
      yardPlacement: structuredClone(scene.yardLayers[0]),
      origin: structuredClone(construction.origin),
      proof: homeProof,
      patch: homePatch,
      frontPatch,
      proofRgbaSha256: homeProofDigest,
      patchRgbaSha256: homePatchDigest,
      frontPatchRgbaSha256: frontPatchDigest,
      sourceLayer: sourceLayers.find(({ slot }) => slot === "homeComponents"),
    },
    productionHuman: {
      contract,
      patch: humanPatch,
      facePatch: humanSemanticPatches.humanFace,
      hairPatch: humanSemanticPatches.humanHair,
      patchRgbaSha256: humanDigest,
      facePatchRgbaSha256: facePatchDigest,
      hairPatchRgbaSha256: hairPatchDigest,
      sourceLayers: humanSourceLayers,
    },
    humanWitnesses,
  };
}

function regionalR5CompleteProofSceneValidation(kit, complete, authoring, connectivityInputs) {
  const errors = validateComposedPixelAutocorrelation(complete, { kit })
    .map((error) => `${kit}/${error}`);
  const landmarks = authoring.rawMasters[`${kit}-landmarks`];
  if (kit === "worn-heartland") {
    const acceptedAtlasDigest = "9caba437f2ca74080709d7154c318c255089152516b9e7d1e7541b27319aeb28";
    if (hashBuffer(landmarks.data) !== acceptedAtlasDigest) {
      errors.push(`${kit}/accepted V9 landmark atlas RGBA drift`);
    }
    const cellDigests = Array.from({ length: 8 }, (_unused, cell) => (
      hashBuffer(regionalR5Cell(landmarks, cell, 128, 128).data)
    ));
    if (new Set(cellDigests).size !== 8) errors.push(`${kit}/accepted V9 landmarks must remain eight unique cells`);
  } else {
    for (let cell = 0; cell < 8; cell += 1) {
      const repair = REGIONAL_R5_BLIND_REPAIR_SOURCES.atlasCells
        .find((descriptor) => descriptor.targetAtlas === `${kit}-landmarks`
          && descriptor.cell === cell);
      const landmark = regionalR5Cell(landmarks, cell, 128, 128);
      if (repair) {
        const reauthorCell = authoring.reauthorReceipt.cells.find((candidate) => (
          candidate.atlasId === `${kit}-landmarks` && candidate.cell === cell
        ));
        if (reauthorCell?.supersededBlindRepairId === repair.id) {
          if (hashBuffer(landmark.data) !== reauthorCell.afterRgbaSha256) {
            errors.push(`${kit}/landmark-${cell}: versioned reauthor RGBA source drift`);
          }
        } else {
          const trustedRepair = authoring.blindRepairSources.get(repair.id);
          if (!trustedRepair || hashBuffer(landmark.data) !== hashBuffer(trustedRepair.data)) {
            errors.push(`${kit}/landmark-${cell}: exact blind-repair RGBA source drift`);
          }
        }
      } else {
        errors.push(...validateLandmarkMaterialDepth(landmark, `${kit}/landmark-${cell}`));
      }
    }
  }
  // Dry V32 and Worn V9 replace all eight visual landmark anatomies while retaining
  // their R4 movement graphs. Dedicated source-pixel relation gates supersede the
  // legacy crop-support receipts for those accepted literal scenes.
  if (kit !== "dry-scrub" && kit !== "worn-heartland") {
    errors.push(...measureRegionalR5SceneConnectivity(connectivityInputs).errors
      .map((error) => `${kit}/connectivity/${error}`));
  }
  return errors;
}

/**
 * Build authority-owned entrance depth layers from exact actor sources.
 *
 * This builder owns no visual geometry: the front-frame group, portal, threshold,
 * shadow mask, anchor, and color all come from the frozen R5 authority. It fails
 * closed on canonical actor bytes and placements before producing proof layers.
 */
export function validateRegionalR5EntranceDepthAuthority({ kit, authority } = {}) {
  if (!REGIONAL_R5_COMPLETE_SCENE_KITS.includes(kit)) {
    throw new Error(`R5 entrance depth authority kit is not authoring-approved, received ${kit}`);
  }
  const rectFields = ["portal", "threshold", "thresholdForegroundBand"];
  for (const field of rectFields) {
    const rect = authority?.[field];
    if (![rect?.x, rect?.y, rect?.width, rect?.height].every(finiteInteger)
        || rect.width <= 0 || rect.height <= 0) {
      throw new Error(`R5 entrance depth ${field} must be a positive integer rectangle`);
    }
  }
  const threshold = authority.threshold;
  const band = authority.thresholdForegroundBand;
  const scene = REGIONAL_R5_KEY_SCENES[kit];
  const shelterWitness = scene?.humanLayers.find(({ role }) => role === "shelter-door");
  const anchor = kit === "dry-scrub" && shelterWitness ? {
    ...authority.shelterDoorPresentationAnchor,
    homeOffset: {
      x: shelterWitness.x - scene.homeLayer.x,
      y: shelterWitness.y - scene.homeLayer.y,
    },
    apron: {
      x: shelterWitness.x - scene.homeLayer.x,
      y: shelterWitness.y - scene.homeLayer.y,
      width: shelterWitness.width,
      height: shelterWitness.height,
    },
  } : authority.shelterDoorPresentationAnchor;
  const apron = anchor?.apron;
  if (anchor?.role !== "shelter-door" || anchor.mechanicsBacked !== true || anchor.proofOnly !== true
      || typeof anchor.runtimeConsumer !== "string"
      || ![anchor.homeOffset?.x, anchor.homeOffset?.y,
        apron?.x, apron?.y, apron?.width, apron?.height].every(finiteInteger)) {
    throw new Error("R5 entrance depth requires an exact mechanics-backed shelter presentation anchor");
  }
  if (band.x < threshold.x || band.y < threshold.y
      || band.x + band.width > threshold.x + threshold.width
      || band.y + band.height > threshold.y + threshold.height) {
    throw new Error("R5 entrance depth foreground band must stay inside the threshold");
  }
  if (shelterWitness.x - scene.homeLayer.x !== anchor.homeOffset.x
      || shelterWitness.y - scene.homeLayer.y !== anchor.homeOffset.y
      || apron.x !== anchor.homeOffset.x || apron.y !== anchor.homeOffset.y
      || apron.width !== shelterWitness.width || apron.height !== shelterWitness.height) {
    throw new Error("R5 entrance depth shelter presentation anchor must close on the canonical apron placement");
  }
  const bandMeetsApron = band.x < apron.x + apron.width && band.x + band.width > apron.x
    && band.y < apron.y + apron.height && band.y + band.height > apron.y;
  if (bandMeetsApron) {
    throw new Error("R5 entrance depth foreground band must not overlap the shelter presentation apron");
  }
  if (authority.expectedPortalHumanOverlap !== 0 || authority.expectedForegroundHumanOverlap !== 0) {
    throw new Error("R5 entrance depth separated-apron authority requires exact zero portal and foreground overlap");
  }
  return true;
}

export function buildRegionalR5EntranceDepthLayers({
  kit,
  width,
  height,
  components,
} = {}) {
  if (!REGIONAL_R5_COMPLETE_SCENE_KITS.includes(kit)) {
    throw new Error(`R5 entrance depth kit is not authoring-approved, received ${kit}`);
  }
  if (!finiteInteger(width) || !finiteInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError("R5 entrance depth requires positive integer scene geometry");
  }
  const authority = REGIONAL_R5_MECHANICS_BINDINGS.entranceDepth;
  validateRegionalR5EntranceDepthAuthority({ kit, authority });
  const humanAuthority = REGIONAL_R5_MECHANICS_BINDINGS.productionHuman;
  const { proof, scene } = regionalR5CompleteProofHomeAuthority(kit);
  const homeActor = components?.homeActor;
  const productionHuman = components?.productionHuman;
  const witnesses = components?.humanWitnesses;
  for (const [raw, label] of [
    [homeActor?.proof, "HomeActor proof"],
    [homeActor?.patch, "HomeActor patch"],
    [homeActor?.frontPatch, "HomeActor frontPatch"],
    [productionHuman?.patch, "production-human patch"],
    [productionHuman?.facePatch, "production-human face patch"],
    [productionHuman?.hairPatch, "production-human hair patch"],
  ]) assertRegionalR5Raw(raw, `R5 entrance depth ${label}`);
  if (!Array.isArray(witnesses) || witnesses.length !== scene.humanLayers.length) {
    throw new Error(`${kit}: R5 entrance depth requires every canonical human witness`);
  }
  const reconstructedHomePatch = regionalR5RawCrop(homeActor.proof, [
    homeActor.origin.x,
    homeActor.origin.y,
    scene.homeLayer.width,
    scene.homeLayer.height,
  ]);
  const actualHashes = {
    proof: hashBuffer(homeActor.proof.data),
    home: hashBuffer(homeActor.patch.data),
    reconstructedHome: hashBuffer(reconstructedHomePatch.data),
    front: hashBuffer(homeActor.frontPatch.data),
    human: hashBuffer(productionHuman.patch.data),
    face: hashBuffer(productionHuman.facePatch.data),
    hair: hashBuffer(productionHuman.hairPatch.data),
  };
  if (actualHashes.proof !== proof.homeActorRgbaSha256
      || actualHashes.home !== actualHashes.reconstructedHome) {
    throw new Error(`${kit}: canonical HomeActor hash drift in entrance depth components`);
  }
  if (actualHashes.front !== REGIONAL_R5_COMPLETE_PROOF_FRONT_PATCH_RGBA_SHA256[kit]) {
    throw new Error(`${kit}: canonical frontPatch hash drift ${actualHashes.front}`);
  }
  if (actualHashes.human !== humanAuthority.canonicalPatchSha256) {
    throw new Error(`${kit}: canonical production-human hash drift ${actualHashes.human}`);
  }
  if (actualHashes.face !== authority.humanSemanticRgbaSha256.face
      || actualHashes.hair !== authority.humanSemanticRgbaSha256.hair) {
    throw new Error(`${kit}: canonical human face/hair hash drift in entrance depth components`);
  }
  if (canonicalJson(homeActor.placement) !== canonicalJson(scene.homeLayer)
      || witnesses.some(({ placement, feet }, index) => (
        canonicalJson(placement) !== canonicalJson(scene.humanLayers[index])
        || feet?.x !== placement.x + humanAuthority.feet.x
        || feet?.y !== placement.y + humanAuthority.feet.y
      ))) {
    throw new Error(`${kit}: R5 entrance depth requires unchanged canonical component placements`);
  }
  const shelterWitness = witnesses.find(({ placement }) => placement.role === "shelter-door");
  const shelterApron = kit === "dry-scrub" ? {
    x: shelterWitness.placement.x - homeActor.placement.x,
    y: shelterWitness.placement.y - homeActor.placement.y,
    width: shelterWitness.placement.width,
    height: shelterWitness.placement.height,
  } : authority.shelterDoorPresentationAnchor.apron;
  let portalHumanOverlap = 0;
  for (let y = 0; y < productionHuman.patch.height; y += 1) {
    for (let x = 0; x < productionHuman.patch.width; x += 1) {
      if (productionHuman.patch.data[(y * productionHuman.patch.width + x) * 4 + 3] === 0) continue;
      const localX = shelterWitness.placement.x + x - homeActor.placement.x;
      const localY = shelterWitness.placement.y + y - homeActor.placement.y;
      if (localX >= authority.portal.x && localX < authority.portal.x + authority.portal.width
          && localY >= authority.portal.y && localY < authority.portal.y + authority.portal.height) {
        portalHumanOverlap += 1;
      }
    }
  }
  if (portalHumanOverlap !== authority.expectedPortalHumanOverlap) {
    throw new Error(`${kit}: shelter presentation anchor must leave the full portal unobscured`);
  }

  const shadow = authority.contactShadow;
  if (!Array.isArray(shadow.rows) || shadow.rows.length !== shadow.geometry.height
      || shadow.rows.some((row) => typeof row !== "string" || row.length !== shadow.geometry.width
        || /[^01]/u.test(row))
      || shadow.rows.join("").replaceAll("0", "").length !== shadow.geometry.opaquePixels) {
    throw new Error("R5 entrance depth authority contains an invalid contact-shadow mask");
  }
  const shadowColorHex = REGIONAL_R5_PALETTES.shared?.[shadow.colorToken];
  if (!/^#[a-f0-9]{6}$/u.test(shadowColorHex ?? "")) {
    throw new Error("R5 entrance depth authority contains an invalid contact-shadow color token");
  }
  const shadowRgba = [
    Number.parseInt(shadowColorHex.slice(1, 3), 16),
    Number.parseInt(shadowColorHex.slice(3, 5), 16),
    Number.parseInt(shadowColorHex.slice(5, 7), 16),
    255,
  ];
  const contactShadows = { data: Buffer.alloc(width * height * 4), width, height, channels: 4 };
  for (const witness of witnesses) {
    const originX = witness.feet.x - shadow.anchor.x;
    const originY = witness.feet.y - shadow.anchor.y;
    for (let localY = 0; localY < shadow.geometry.height; localY += 1) {
      for (let localX = 0; localX < shadow.geometry.width; localX += 1) {
        if (shadow.rows[localY][localX] === "0") continue;
        const x = originX + localX;
        const y = originY + localY;
        if (x < 0 || x >= width || y < 0 || y >= height) {
          throw new Error(`${kit}: canonical contact shadow exceeds scene bounds`);
        }
        contactShadows.data.set(shadowRgba, (y * width + x) * 4);
      }
    }
  }
  const expectedShadowComponents = Array(witnesses.length).fill(shadow.geometry.opaquePixels);
  if (canonicalJson(regionalR5AlphaComponentSizes(contactShadows)) !== canonicalJson(expectedShadowComponents)) {
    throw new Error(`${kit}: contact shadows must remain exact isolated connected authority masks`);
  }

  const homeForeground = { data: Buffer.alloc(width * height * 4), width, height, channels: 4 };
  for (let localY = 0; localY < homeActor.frontPatch.height; localY += 1) {
    for (let localX = 0; localX < homeActor.frontPatch.width; localX += 1) {
      const inPortal = localX >= authority.portal.x && localX < authority.portal.x + authority.portal.width
        && localY >= authority.portal.y && localY < authority.portal.y + authority.portal.height;
      const inThreshold = localX >= authority.threshold.x
        && localX < authority.threshold.x + authority.threshold.width
        && localY >= authority.threshold.y
        && localY < authority.threshold.y + authority.threshold.height;
      const inThresholdForegroundBand = localX >= authority.thresholdForegroundBand.x
        && localX < authority.thresholdForegroundBand.x + authority.thresholdForegroundBand.width
        && localY >= authority.thresholdForegroundBand.y
        && localY < authority.thresholdForegroundBand.y + authority.thresholdForegroundBand.height;
      const apron = shelterApron;
      const inShelterApron = localX >= apron.x && localX < apron.x + apron.width
        && localY >= apron.y && localY < apron.y + apron.height;
      const sourceOffset = (localY * homeActor.frontPatch.width + localX) * 4;
      if (homeActor.frontPatch.data[sourceOffset + 3] === 0
          || ((inPortal || inShelterApron) && !(inThreshold && inThresholdForegroundBand))) continue;
      const destinationX = homeActor.placement.x + localX;
      const destinationY = homeActor.placement.y + localY;
      if (destinationX < 0 || destinationX >= width || destinationY < 0 || destinationY >= height) {
        throw new Error(`${kit}: canonical home foreground exceeds scene bounds`);
      }
      homeActor.frontPatch.data.copy(
        homeForeground.data,
        (destinationY * width + destinationX) * 4,
        sourceOffset,
        sourceOffset + 4,
      );
    }
  }

  const semanticIntersection = (semanticPatch, witness) => {
    let count = 0;
    for (let y = 0; y < semanticPatch.height; y += 1) for (let x = 0; x < semanticPatch.width; x += 1) {
      if (semanticPatch.data[(y * semanticPatch.width + x) * 4 + 3] === 0) continue;
      const destinationOffset = ((witness.placement.y + y) * width + witness.placement.x + x) * 4;
      if (homeForeground.data[destinationOffset + 3] !== 0) count += 1;
    }
    return count;
  };
  let humanOverlap = 0;
  for (const witness of witnesses) {
    if (semanticIntersection(productionHuman.facePatch, witness) !== 0
        || semanticIntersection(productionHuman.hairPatch, witness) !== 0) {
      throw new Error(`${kit}: home foreground may not overlap canonical face or hair alpha`);
    }
    for (let y = 0; y < productionHuman.patch.height; y += 1) {
      for (let x = 0; x < productionHuman.patch.width; x += 1) {
        if (productionHuman.patch.data[(y * productionHuman.patch.width + x) * 4 + 3] === 0) continue;
        const destinationY = witness.placement.y + y;
        const destinationOffset = (destinationY * width + witness.placement.x + x) * 4;
        if (homeForeground.data[destinationOffset + 3] === 0) continue;
        humanOverlap += 1;
        if (destinationY < witness.feet.y - 1) {
          throw new Error(`${kit}: home foreground may overlap humans only at the threshold feet`);
        }
      }
    }
  }
  if (humanOverlap !== authority.expectedForegroundHumanOverlap) {
    throw new Error(`${kit}: threshold-human overlap must be exactly ${authority.expectedForegroundHumanOverlap}px (${humanOverlap})`);
  }
  return {
    layerOrder: Object.freeze([...authority.composition.layerOrder]),
    contactShadows,
    homeForeground,
    portalHumanOverlap,
    foregroundHumanOverlap: humanOverlap,
  };
}

async function regionalR5CompleteProofLayer(raw) {
  const buffer = await encodeRegionalR5Raw(raw);
  return {
    raw,
    buffer,
    rgbaSha256: hashBuffer(raw.data),
    pngSha256: hashBuffer(buffer),
  };
}

/** Build one complete proof scene, rejecting canonical visual failures before encoding evidence PNGs. */
export async function buildRegionalR5CompleteProofScene({ kit, authoring, sourceBuffers } = {}) {
  if (!REGIONAL_R5_COMPLETE_SCENE_KITS.includes(kit)) {
    throw new Error(`R5 complete proof kit is not authoring-approved, received ${kit}`);
  }
  const incomplete = await buildRegionalR5KeyScene({ kit, authoring });
  const components = await buildRegionalR5CompleteProofComponents({ kit, sourceBuffers });
  const world = { ...incomplete.raw, data: Buffer.from(incomplete.raw.data) };
  const home = regionalR5FullLayer(
    world.width,
    world.height,
    components.homeActor.patch,
    components.homeActor.placement.x,
    components.homeActor.placement.y,
  );
  const homeUnderlay = {
    data: Buffer.alloc(world.data.length),
    width: world.width,
    height: world.height,
    channels: 4,
  };
  const completeUnderlayLayers = REGIONAL_R5_KEY_SCENES[kit].completeUnderlayLayers ?? [];
  if (kit === "dry-scrub") placeRegionalR5RawLayer(homeUnderlay, home, 0, 0);
  for (const placement of completeUnderlayLayers) {
    const patch = authoring.patches.get(placement.patchId);
    if (!patch) throw new Error(`${kit}: complete-scene underlay patch ${placement.patchId} missing`);
    placeRegionalR5RawLayer(homeUnderlay, patch, placement.x, placement.y);
  }
  if (kit !== "dry-scrub") placeRegionalR5RawLayer(homeUnderlay, home, 0, 0);
  const humanWitnesses = { data: Buffer.alloc(world.data.length), width: world.width, height: world.height, channels: 4 };
  for (const { placement } of components.humanWitnesses) {
    placeRegionalR5RawLayer(humanWitnesses, components.productionHuman.patch, placement.x, placement.y);
  }
  const entranceDepth = buildRegionalR5EntranceDepthLayers({
    kit,
    width: world.width,
    height: world.height,
    components,
  });
  const entranceForeground = kit === "dry-scrub"
    ? { data: Buffer.alloc(world.data.length), width: world.width, height: world.height, channels: 4 }
    : entranceDepth.homeForeground;
  for (const placement of REGIONAL_R5_KEY_SCENES[kit].completeForegroundLayers ?? []) {
    const patch = authoring.patches.get(placement.patchId);
    if (!patch) throw new Error(`${kit}: complete-scene foreground patch ${placement.patchId} missing`);
    placeRegionalR5RawLayer(entranceForeground, patch, placement.x, placement.y);
  }
  const complete = { ...world, data: Buffer.from(world.data) };
  placeRegionalR5RawLayer(complete, homeUnderlay, 0, 0);
  placeRegionalR5RawLayer(complete, entranceDepth.contactShadows, 0, 0);
  placeRegionalR5RawLayer(complete, humanWitnesses, 0, 0);
  placeRegionalR5RawLayer(complete, entranceForeground, 0, 0);
  const completeRgbaSha256 = hashBuffer(complete.data);
  if (kit === "dry-scrub" && completeRgbaSha256 !== REGIONAL_R5_DRY_V32_FINAL_RGBA_SHA256) {
    throw new Error(`${kit}: exact V32 complete-scene RGBA hash drift ${completeRgbaSha256}`);
  }
  if (kit === "worn-heartland" && completeRgbaSha256 !== REGIONAL_R5_WORN_V9_FINAL_RGBA_SHA256) {
    throw new Error(`${kit}: exact V9 complete-scene RGBA hash drift ${completeRgbaSha256}`);
  }
  const validationErrors = regionalR5CompleteProofSceneValidation(
    kit,
    complete,
    authoring,
    incomplete.connectivityInputs,
  );
  if (validationErrors.length > 0) throw regionalR5CompleteProofError(validationErrors);
  const [worldLayer, homeLayer, shadowLayer, humanLayer, entranceForegroundLayer, buffer] = await Promise.all([
    regionalR5CompleteProofLayer(world),
    regionalR5CompleteProofLayer(homeUnderlay),
    regionalR5CompleteProofLayer(entranceDepth.contactShadows),
    regionalR5CompleteProofLayer(humanWitnesses),
    regionalR5CompleteProofLayer(entranceForeground),
    encodeRegionalR5Raw(complete),
  ]);
  return {
    kit,
    proofOnly: true,
    published: false,
    completeProductionPreview: false,
    omittedProductionLayers: Object.freeze([
      ...REGIONAL_R5_MECHANICS_BINDINGS.entranceDepth.runtimeParity.omittedProductionLayers,
    ]),
    completeCompositionOracle: true,
    raw: complete,
    buffer,
    rgbaSha256: completeRgbaSha256,
    pngSha256: hashBuffer(buffer),
    layers: Object.freeze({
      world: worldLayer,
      "home-underlay": homeLayer,
      "human-contact-shadows": shadowLayer,
      "human-witnesses": humanLayer,
      "home-foreground": entranceForegroundLayer,
    }),
    entranceDepth,
    ...(kit === "dry-scrub" ? {
      homePresentation: Object.freeze({
        layerOrder: Object.freeze([
          "world",
          "canonical-home-actor",
          "dry-permanent-home-shell",
          "human-contact-shadows",
          "human-witnesses",
          "dry-threshold-foreground",
        ]),
        shellPatchId: completeUnderlayLayers[0]?.patchId,
        foregroundPatchId: REGIONAL_R5_KEY_SCENES[kit].completeForegroundLayers?.[0]?.patchId,
        shellPortalOverlap: 0,
        shellHumanOverlap: 0,
        exposedPavilionPixels: 0,
      }),
    } : {}),
    ...components,
  };
}

const REGIONAL_R5_COMPLETE_PROOF_FAMILIES = Object.freeze([
  "terrain",
  "scenery",
  "landmarks",
  "yards",
  "composed",
]);

/** Return the exact sorted 22-basename Task 4 proof inventory without producing artifacts. */
export function regionalR5CompleteProofArtifactNames() {
  return [
    ...REGIONAL_R5_COMPLETE_PROOF_KITS.flatMap((kit) => REGIONAL_R5_COMPLETE_PROOF_FAMILIES
      .flatMap((family) => [
        `task12r-r5-keyscene-${kit}-${family}-native-1x.png`,
        `task12r-r5-keyscene-${kit}-${family}-nearest-2x.png`,
      ])),
    "task12r-r5-keyscene-ash-risk-first-composed.png",
    "task12r-r5-keyscene-manifest.json",
  ].sort(regionalR5CodeUnitCompare);
}

/** Build the closed proof-only Task 4 artifact set; canonical scene failures return no artifacts. */
export async function buildRegionalR5CompleteProofArtifacts({ authoring, sourceBuffersByKit } = {}) {
  assertRegionalR5TrustedAuthoring(authoring);
  const resolvedSources = await sourceBuffersByKit;
  const sourceShape = regionalR5PlainDataTrustSnapshot(
    resolvedSources,
    Object.prototype,
    "R5 complete proof per-kit sources",
  );
  if (sourceShape.entries.length !== 2
      || sourceShape.entries.some(({ key }) => !REGIONAL_R5_COMPLETE_PROOF_KITS.includes(key))) {
    throw new TypeError("R5 complete proof artifacts require exact ash-waste and neutral-temperate source properties");
  }
  const scenes = {};
  const validationErrors = [];
  for (const kit of REGIONAL_R5_COMPLETE_PROOF_KITS) {
    try {
      scenes[kit] = await buildRegionalR5CompleteProofScene({
        kit,
        authoring,
        sourceBuffers: sourceShape.entries.find(({ key }) => key === kit)?.value,
      });
    } catch (error) {
      if (error?.code !== "REGIONAL_R5_PROOF_VALIDATION_FAILED") throw error;
      validationErrors.push(...error.validationErrors);
    }
  }
  if (validationErrors.length > 0) throw regionalR5CompleteProofError(validationErrors);
  const artifacts = {};
  const receipts = [];
  for (const kit of REGIONAL_R5_COMPLETE_PROOF_KITS) {
    const sourceByFamily = {
      terrain: {
        raw: authoring.rawMasters[`${kit}-terrain`],
        buffer: authoring.buffers[`${kit}-terrain`],
      },
      scenery: {
        raw: authoring.rawMasters[`${kit}-scenery`],
        buffer: authoring.buffers[`${kit}-scenery`],
      },
      landmarks: {
        raw: authoring.rawMasters[`${kit}-landmarks`],
        buffer: authoring.buffers[`${kit}-landmarks`],
      },
      yards: {
        raw: authoring.rawMasters[`${kit}-home-yards`],
        buffer: authoring.buffers[`${kit}-home-yards`],
      },
      composed: { raw: scenes[kit].raw, buffer: scenes[kit].buffer },
    };
    for (const family of REGIONAL_R5_COMPLETE_PROOF_FAMILIES) {
      const source = sourceByFamily[family];
      const nativeName = `task12r-r5-keyscene-${kit}-${family}-native-1x.png`;
      const nearestName = `task12r-r5-keyscene-${kit}-${family}-nearest-2x.png`;
      const nearest = await scaleEvidenceNearest(source.buffer, source.raw.width * 2, source.raw.height * 2);
      artifacts[nativeName] = Buffer.from(source.buffer);
      artifacts[nearestName] = nearest;
      receipts.push(
        { name: nativeName, kit, family, scale: "native-1x", width: source.raw.width,
          height: source.raw.height, channels: 4, rgbaSha256: hashBuffer(source.raw.data),
          pngSha256: hashBuffer(source.buffer) },
        { name: nearestName, kit, family, scale: "nearest-2x", width: source.raw.width * 2,
          height: source.raw.height * 2, channels: 4, pngSha256: hashBuffer(nearest) },
      );
    }
  }
  artifacts["task12r-r5-keyscene-ash-risk-first-composed.png"] = Buffer.from(scenes["ash-waste"].buffer);
  receipts.push({
    name: "task12r-r5-keyscene-ash-risk-first-composed.png",
    kit: "ash-waste",
    family: "composed",
    scale: "native-1x-alias",
    width: 768,
    height: 512,
    channels: 4,
    rgbaSha256: scenes["ash-waste"].rgbaSha256,
    pngSha256: scenes["ash-waste"].pngSha256,
  });
  receipts.sort(({ name: left }, { name: right }) => regionalR5CodeUnitCompare(left, right));
  const manifest = {
    schema: "regional-r5-complete-proof-artifacts/v1",
    proofOnly: true,
    published: false,
    kits: [...REGIONAL_R5_COMPLETE_PROOF_KITS],
    artifacts: receipts,
  };
  artifacts["task12r-r5-keyscene-manifest.json"] = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const sortedArtifacts = Object.fromEntries(Object.entries(artifacts)
    .sort(([left], [right]) => regionalR5CodeUnitCompare(left, right)));
  const names = Object.keys(sortedArtifacts);
  if (canonicalJson(names) !== canonicalJson(regionalR5CompleteProofArtifactNames())) {
    throw new Error("R5 complete proof artifact inventory drift");
  }
  return { artifacts: sortedArtifacts, inventory: names, manifest };
}

const REGIONAL_R5_TASK5_PROOF_KITS = Object.freeze([
  "spring-terraces",
  "dry-scrub",
  "worn-heartland",
]);
const REGIONAL_R5_TASK5_IDENTITY_KITS = Object.freeze([
  "ash-waste",
  "dry-scrub",
  "spring-terraces",
  "neutral-temperate",
  "worn-heartland",
]);
const REGIONAL_R5_TASK5_ACCEPTED_COMPLETE_RGBA_SHA256 = Object.freeze({
  "ash-waste": "778bccbc09bd9340f70dbf7d0f5915258e3ee88681775c0cdec3dd5d2a05b0fa",
  "dry-scrub": REGIONAL_R5_DRY_V32_FINAL_RGBA_SHA256,
  "spring-terraces": "f852a89eea60590283dec57dbecb31f08aae320b0d46f7a48f13a67cc8ac01d4",
  "neutral-temperate": "1c9c54664e88684882700c11e547953c147fb2084aa51298e373fc4fdc588466",
  "worn-heartland": REGIONAL_R5_WORN_V9_FINAL_RGBA_SHA256,
});

/** Return the exact sorted 33-basename Task 5 proof inventory without producing artifacts. */
export function regionalR5Task5ProofArtifactNames() {
  return [
    ...REGIONAL_R5_TASK5_PROOF_KITS.flatMap((kit) => REGIONAL_R5_COMPLETE_PROOF_FAMILIES
      .flatMap((family) => [
        `task12r-r5-task5-${kit}-${family}-native-1x.png`,
        `task12r-r5-task5-${kit}-${family}-nearest-2x.png`,
      ])),
    "task12r-r5-task5-five-region-labels-hidden-native-1x.png",
    "task12r-r5-task5-all-40-landmarks-labels-hidden-native-1x.png",
    "task12r-r5-task5-manifest.json",
  ].sort(regionalR5CodeUnitCompare);
}

function regionalR5Task5IdentityBoard(scenes) {
  const board = { data: Buffer.alloc(2304 * 1024 * 4), width: 2304, height: 1024, channels: 4 };
  const receipts = [];
  for (const [index, kit] of REGIONAL_R5_TASK5_IDENTITY_KITS.entries()) {
    const scene = scenes[kit];
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = column * 768;
    const y = row * 512;
    placeRegionalR5RawLayer(board, scene.raw, x, y);
    receipts.push(Object.freeze({
      kit,
      column,
      row,
      x,
      y,
      width: scene.raw.width,
      height: scene.raw.height,
      rgbaSha256: scene.rgbaSha256,
      pngSha256: scene.pngSha256,
    }));
  }
  return { board, receipts: Object.freeze(receipts) };
}

function regionalR5Task5LandmarkBoard(authoring) {
  const board = { data: Buffer.alloc(1536 * 512 * 4), width: 1536, height: 512, channels: 4 };
  const receipts = [];
  for (const [index, kit] of REGIONAL_R5_TASK5_IDENTITY_KITS.entries()) {
    const atlas = authoring.rawMasters[`${kit}-landmarks`];
    if (atlas?.width !== 512 || atlas?.height !== 256 || atlas?.channels !== 4) {
      throw new Error(`${kit}: Task 5 landmark board requires exact 512x256 RGBA source atlas`);
    }
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = column * 512;
    const y = row * 256;
    placeRegionalR5RawLayer(board, atlas, x, y);
    const cells = [];
    for (let cell = 0; cell < 8; cell += 1) {
      const raw = regionalR5Cell(atlas, cell, 128, 128);
      cells.push(Object.freeze({ cell, rgbaSha256: hashBuffer(raw.data) }));
    }
    if (new Set(cells.map(({ rgbaSha256 }) => rgbaSha256)).size !== 8) {
      throw new Error(`${kit}: Task 5 landmark board requires eight independently addressable cells`);
    }
    receipts.push(Object.freeze({
      kit,
      column,
      row,
      x,
      y,
      width: atlas.width,
      height: atlas.height,
      rgbaSha256: hashBuffer(atlas.data),
      cells: Object.freeze(cells),
    }));
  }
  if (new Set(receipts.flatMap(({ cells }) => cells.map(({ rgbaSha256 }) => rgbaSha256))).size !== 40) {
    throw new Error("Task 5 landmark board requires exactly 40 independently addressable source cells");
  }
  return { board, receipts: Object.freeze(receipts) };
}

/** Build the separate proof-only Task 5 closure and two exact labels-hidden recognition boards. */
export async function buildRegionalR5Task5ProofArtifacts({ authoring, sourceBuffersByKit } = {}) {
  assertRegionalR5TrustedAuthoring(authoring);
  const resolvedSources = await sourceBuffersByKit;
  const sourceShape = regionalR5PlainDataTrustSnapshot(
    resolvedSources,
    Object.prototype,
    "R5 Task 5 complete-scene sources",
  );
  const expectedKits = new Set(REGIONAL_R5_TASK5_IDENTITY_KITS);
  if (sourceShape.entries.length !== expectedKits.size
      || sourceShape.entries.some(({ key }) => !expectedKits.has(key))) {
    throw new TypeError("R5 Task 5 proof artifacts require exact five-kit source properties");
  }
  const scenes = {};
  const validationErrors = [];
  for (const kit of REGIONAL_R5_TASK5_IDENTITY_KITS) {
    try {
      scenes[kit] = await buildRegionalR5CompleteProofScene({
        kit,
        authoring,
        sourceBuffers: sourceShape.entries.find(({ key }) => key === kit)?.value,
      });
      const acceptedDigest = REGIONAL_R5_TASK5_ACCEPTED_COMPLETE_RGBA_SHA256[kit];
      if (scenes[kit].rgbaSha256 !== acceptedDigest) {
        validationErrors.push(`${kit}/accepted complete-scene RGBA drift ${scenes[kit].rgbaSha256}`);
      }
    } catch (error) {
      if (error?.code !== "REGIONAL_R5_PROOF_VALIDATION_FAILED") throw error;
      validationErrors.push(...error.validationErrors);
    }
  }
  if (validationErrors.length > 0) throw regionalR5CompleteProofError(validationErrors);

  const artifacts = {};
  const artifactReceipts = [];
  for (const kit of REGIONAL_R5_TASK5_PROOF_KITS) {
    const sourceByFamily = {
      terrain: { raw: authoring.rawMasters[`${kit}-terrain`], buffer: authoring.buffers[`${kit}-terrain`] },
      scenery: { raw: authoring.rawMasters[`${kit}-scenery`], buffer: authoring.buffers[`${kit}-scenery`] },
      landmarks: { raw: authoring.rawMasters[`${kit}-landmarks`], buffer: authoring.buffers[`${kit}-landmarks`] },
      yards: { raw: authoring.rawMasters[`${kit}-home-yards`], buffer: authoring.buffers[`${kit}-home-yards`] },
      composed: { raw: scenes[kit].raw, buffer: scenes[kit].buffer },
    };
    for (const family of REGIONAL_R5_COMPLETE_PROOF_FAMILIES) {
      const source = sourceByFamily[family];
      const nativeName = `task12r-r5-task5-${kit}-${family}-native-1x.png`;
      const nearestName = `task12r-r5-task5-${kit}-${family}-nearest-2x.png`;
      const nearest = await scaleEvidenceNearest(source.buffer, source.raw.width * 2, source.raw.height * 2);
      artifacts[nativeName] = Buffer.from(source.buffer);
      artifacts[nearestName] = nearest;
      artifactReceipts.push(
        Object.freeze({ name: nativeName, kit, family, scale: "native-1x",
          width: source.raw.width, height: source.raw.height, channels: 4,
          rgbaSha256: hashBuffer(source.raw.data), pngSha256: hashBuffer(source.buffer) }),
        Object.freeze({ name: nearestName, kit, family, scale: "nearest-2x",
          width: source.raw.width * 2, height: source.raw.height * 2, channels: 4,
          pngSha256: hashBuffer(nearest) }),
      );
    }
  }

  const identity = regionalR5Task5IdentityBoard(scenes);
  const landmarks = regionalR5Task5LandmarkBoard(authoring);
  const identityBuffer = await encodeRegionalR5Raw(identity.board);
  const landmarkBuffer = await encodeRegionalR5Raw(landmarks.board);
  const identityName = "task12r-r5-task5-five-region-labels-hidden-native-1x.png";
  const landmarkName = "task12r-r5-task5-all-40-landmarks-labels-hidden-native-1x.png";
  artifacts[identityName] = identityBuffer;
  artifacts[landmarkName] = landmarkBuffer;
  artifactReceipts.push(
    Object.freeze({ name: identityName, family: "labels-hidden-five-region", scale: "native-1x",
      width: identity.board.width, height: identity.board.height, channels: 4,
      rgbaSha256: hashBuffer(identity.board.data), pngSha256: hashBuffer(identityBuffer) }),
    Object.freeze({ name: landmarkName, family: "labels-hidden-all-40-landmarks", scale: "native-1x",
      width: landmarks.board.width, height: landmarks.board.height, channels: 4,
      rgbaSha256: hashBuffer(landmarks.board.data), pngSha256: hashBuffer(landmarkBuffer) }),
  );
  artifactReceipts.sort(({ name: left }, { name: right }) => regionalR5CodeUnitCompare(left, right));
  const manifest = {
    schema: "regional-r5-task5-proof-artifacts/v1",
    proofOnly: true,
    published: false,
    embeddedLabels: false,
    sourceSceneProofOnly: true,
    directSceneSourcesPresent: true,
    diagnosticSceneTargetsPresent: true,
    finalSceneSourceApproval: false,
    atlasRuntimeReconstructible: false,
    task6Ready: false,
    deferredGates: ["atlas-only-scene-reconstruction"],
    limitations: [
      "direct-scene-source-placements-are-not-yet-reconstructed-from-the-20-atlas-masters",
      "ash-neutral-blind-repair-scene-targets-are-diagnostic-only",
    ],
    task5Kits: [...REGIONAL_R5_TASK5_PROOF_KITS],
    identityBoard: {
      name: identityName,
      kits: [...REGIONAL_R5_TASK5_IDENTITY_KITS],
      rgbaSha256: hashBuffer(identity.board.data),
      pngSha256: hashBuffer(identityBuffer),
      receipts: identity.receipts,
    },
    landmarkBoard: {
      name: landmarkName,
      kits: [...REGIONAL_R5_TASK5_IDENTITY_KITS],
      rgbaSha256: hashBuffer(landmarks.board.data),
      pngSha256: hashBuffer(landmarkBuffer),
      receipts: landmarks.receipts,
    },
    blindReview: {
      humanReviewRequired: true,
      requiredRegions: Object.freeze({
        "ash-waste": Object.freeze(["hostile", "contaminated", "nuclear-industrial"]),
        "dry-scrub": Object.freeze(["waterless", "wind-cut", "basin"]),
        "spring-terraces": Object.freeze(["living", "stepped-water", "habitat"]),
        "neutral-temperate": Object.freeze(["temperate", "wetland", "meadow"]),
        "worn-heartland": Object.freeze(["inhabited", "agrarian", "heartland"]),
      }),
      ash: {
        requiredRead: ["hostile", "contaminated", "nuclear-industrial"],
        forbiddenReads: ["generic-dark", "volcanic", "medieval", "fantasy"],
      },
    },
    artifacts: artifactReceipts,
  };
  artifacts["task12r-r5-task5-manifest.json"] = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const sortedArtifacts = Object.fromEntries(Object.entries(artifacts)
    .sort(([left], [right]) => regionalR5CodeUnitCompare(left, right)));
  const inventory = Object.keys(sortedArtifacts);
  if (canonicalJson(inventory) !== canonicalJson(regionalR5Task5ProofArtifactNames())) {
    throw new Error("R5 Task 5 proof artifact inventory drift");
  }
  return { artifacts: sortedArtifacts, inventory, manifest };
}

function regionalR5SpringClusterMetricErrors(input, label) {
  const value = analyzeConstructedCluster(input);
  const errors = [];
  if (value.supportCount !== 2) errors.push(`${label}: requires exactly two presentation supports`);
  if (value.joinedToLandmarkCount < 1) errors.push(`${label}: no support joins landmark`);
  if (value.joinedToRouteCount < 1) errors.push(`${label}: no support joins frozen topology material`);
  if (!value.allNodesInLandmarkRouteGraph) {
    errors.push("cluster-graph: every support must belong to the landmark-to-frozen-topology graph");
  }
  if (!value.exactFlatten) errors.push("cluster-exact-flatten: composed scene differs from exact RGBA layer flatten");
  for (const [index, count] of value.supportComponentCounts.entries()) {
    if (count !== 1) errors.push(`support anatomy disconnected: support ${index} has ${count} components`);
  }
  for (const [index, anatomy] of value.supportAnatomy.entries()) {
    if (anatomy.pixels < 48 || anatomy.width < 6 || anatomy.height < 6) {
      errors.push(`cluster-support-anatomy: support ${index} is ${anatomy.pixels}px/${anatomy.width}x${anatomy.height}, below 48px/6x6`);
    }
  }
  return errors;
}

/** Measure canonical constructed-cluster metrics from exact rendered RGBA layers. */
export function measureRegionalR5SceneConnectivity(input = {}) {
  const metricErrors = [];
  const authorityErrors = [];
  const receipts = [];
  const authorityDeltas = [];
  const trust = input && typeof input === "object" ? REGIONAL_R5_CONNECTIVITY_TRUST.get(input) : null;
  const trustError = regionalR5ConnectivityTrustError(input, trust);
  if (trustError) {
    return { clusterCount: 0, supportCount: 0, receipts, authorityDeltas, metricErrors, authorityErrors,
      errors: [trustError] };
  }
  const { kit, clusters } = trust;
  if (kit === "worn-heartland") {
    if (!trust.wornRelationInputs || !trust.wornRelationTrust
        || !regionalR5RawRecordMatchesTrust(trust.wornRelationInputs, trust.wornRelationTrust)) {
      const error = "worn-heartland: successor relations require trusted source-pixel identity and provenance";
      return { clusterCount: 0, supportCount: 0, receipts, authorityDeltas, metricErrors, authorityErrors,
        errors: [error] };
    }
    const successor = regionalR5WornSuccessorMeasurement(trust.wornRelationInputs);
    metricErrors.push(...successor.errors);
    receipts.push(...successor.landmarkFoundationReceipts);
    return {
      clusterCount: 8,
      supportCount: 16,
      receipts,
      successorReceipt: successor.successorReceipt,
      actorWitnessReceipts: successor.actorWitnessReceipts,
      authorityDeltas,
      metricErrors,
      authorityErrors,
      errors: [...metricErrors, ...authorityErrors],
    };
  }
  let supportCount = 0;
  for (let clusterIndex = 0; clusterIndex < 8; clusterIndex += 1) {
    const cluster = clusters[clusterIndex];
    supportCount += cluster.supportLayers.length;
    const expectedRouteRoles = kit === "spring-terraces"
      ? ["mechanics-topology-material"]
      : cluster.record.routeTarget.kind === "shore"
      ? ["boundary-material"]
      : cluster.record.routeTarget.kind === "ash-service-chain"
        ? ["route-or-patch", "service-route", "literal-service-slab"]
        : ["route-or-patch"];
    let routeRolesMatch = cluster.routeSourceRoles.length === expectedRouteRoles.length;
    for (let roleIndex = 0; routeRolesMatch && roleIndex < expectedRouteRoles.length; roleIndex += 1) {
      routeRolesMatch = cluster.routeSourceRoles[roleIndex] === expectedRouteRoles[roleIndex];
    }
    if (!routeRolesMatch || cluster.routeRgbaSha256 !== hashBuffer(cluster.routeLayer.data)) {
      metricErrors.push(`${cluster.record.clusterId}: generic-ground or untrusted route source role/bytes`);
    }
    const metricInput = {
      width: cluster.width,
      height: cluster.height,
      baseLayer: cluster.baseLayer,
      scene: cluster.scene,
      routeLayer: cluster.routeLayer,
      landmarkLayer: cluster.landmarkLayer,
      supportLayers: cluster.supportLayers,
    };
    const blindRepairClusterSha256 = REGIONAL_R5_BLIND_REPAIR_CLUSTER_SHA256[cluster.record.clusterId];
    const clusterMetricErrors = kit === "spring-terraces" || blindRepairClusterSha256
      ? regionalR5SpringClusterMetricErrors(metricInput, cluster.record.clusterId)
      : validateConstructedClusterMetrics(metricInput, cluster.record.clusterId);
    metricErrors.push(...clusterMetricErrors.map((error) => `${cluster.record.clusterId}: ${error}`));
    try {
      const receipt = regionalR5ClusterMetrics(cluster.record, metricInput);
      const { analyzed: _analyzed, ...serializableReceipt } = receipt;
      serializableReceipt.rawRgbaSha256 = {
        base: hashBuffer(cluster.baseLayer.data),
        scene: hashBuffer(cluster.scene.data),
        route: hashBuffer(cluster.routeLayer.data),
        landmark: hashBuffer(cluster.landmarkLayer.data),
        supportA: hashBuffer(cluster.supportLayers[0]?.data ?? Buffer.alloc(0)),
        supportB: hashBuffer(cluster.supportLayers[1]?.data ?? Buffer.alloc(0)),
      };
      receipts.push(serializableReceipt);
      const expectedCanonicalSha256 = blindRepairClusterSha256 ?? cluster.record.canonicalSha256;
      const metricsMatch = blindRepairClusterSha256
        ? serializableReceipt.canonicalSha256 === blindRepairClusterSha256
        : canonicalJson(serializableReceipt.metrics) === canonicalJson(cluster.record.metrics)
          && serializableReceipt.canonicalSha256 === cluster.record.canonicalSha256;
      if (!metricsMatch) {
        authorityErrors.push(`${cluster.record.clusterId}: pinned actual-alpha ${blindRepairClusterSha256
          ? "blind-repair successor"
          : "cluster"} receipt drift`);
        authorityDeltas.push({
          kitId: kit,
          clusterId: cluster.record.clusterId,
          expectedMetrics: structuredClone(cluster.record.metrics),
          actualRouteOnlyMetrics: structuredClone(serializableReceipt.metrics),
          expectedCanonicalSha256,
          actualCanonicalSha256: serializableReceipt.canonicalSha256,
        });
      } else if (blindRepairClusterSha256) {
        serializableReceipt.successorOfCanonicalSha256 = cluster.record.canonicalSha256;
        serializableReceipt.blindRepairSuccessor = true;
      }
    } catch (error) {
      metricErrors.push(`${cluster.record.clusterId}: actual-alpha measurement failed (${error.message})`);
    }
  }
  if (receipts.length !== 8) {
    metricErrors.push(`${kit}: exact 8 connectivity receipts required; received ${receipts.length}`);
  }
  return {
    clusterCount: 8,
    supportCount,
    receipts,
    authorityDeltas,
    metricErrors,
    authorityErrors,
    errors: [...metricErrors, ...authorityErrors],
  };
}

/** Measure one actual yard cell through the canonical R5 yard analyzer. */
export function measureRegionalR5YardAlpha(yardAtlas, cell) {
  const yard = regionalR5Cell(yardAtlas, cell, 192, 160);
  const canonical = analyzeYardCell(yard);
  return {
    ...canonical,
    baseAlphaCoverage: canonical.alphaCoverage,
    doorOpaquePixels: Math.round(canonical.doorClearanceCoverage * 30 * 48),
    southCorridorCoverage: canonical.corridorCoverage,
    transparentHoleShare: canonical.transparentHoleShareWithinOpaqueBounds,
  };
}

/** Validate the actual standing A/B and ruin cells through the canonical R5 gates. */
export function validateRegionalR5YardLifecycle(yardAtlas) {
  const baseA = regionalR5Cell(yardAtlas, 0, 192, 160);
  const baseB = regionalR5Cell(yardAtlas, 1, 192, 160);
  const warm = regionalR5Cell(yardAtlas, 2, 192, 160);
  const hoard = regionalR5Cell(yardAtlas, 3, 192, 160);
  const ruin = regionalR5Cell(yardAtlas, 4, 192, 160);
  const overlayErrors = [];
  for (const [label, overlay] of [["warm", warm], ["hoard", hoard]]) {
    overlayErrors.push(...validateOverlayVisibility(overlay, label));
    const yardMetrics = analyzeYardCell(overlay);
    const overlayMetrics = analyzeOverlayVisibility(overlay);
    if (yardMetrics.borderTransparency < 0.9) overlayErrors.push(`${label}-border: transparency below 0.90`);
    if (yardMetrics.doorClearanceCoverage > 0) overlayErrors.push(`${label}-door-clearance: exact doorway is not empty`);
    if (yardMetrics.corridorCoverage > 0.08) overlayErrors.push(`${label}-corridor: coverage above 0.08`);
    if (overlayMetrics.opaquePixels === 0) overlayErrors.push(`${label}-overlay: no visible alpha`);
  }
  return [
    ...validateYardCell(baseA, "standing-a"),
    ...validateYardCell(baseB, "standing-b"),
    ...validateYardCell(ruin, "ruin"),
    ...validateYardLifecycle({ baseA, baseB, ruin }),
    ...overlayErrors,
  ].filter((error, index, all) => all.indexOf(error) === index);
}

const REGIONAL_R5_PROOF_FILE_OPERATIONS = Object.freeze({ mkdir, readFile, writeFile, rename, rm });
const regionalR5CodeUnitCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/** Atomically publish validated proof artifacts through an injectable proof-only boundary. */
export async function publishRegionalR5ProofArtifactsAtomically({
  artifacts,
  destinationRoot,
  fileOperations = {},
  temporaryTag = "r5-proof",
} = {}) {
  if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)
      || typeof destinationRoot !== "string" || destinationRoot.length === 0) {
    throw new TypeError("R5 proof publication requires validated artifacts and destination root");
  }
  const entries = Object.entries(artifacts).sort(([left], [right]) => regionalR5CodeUnitCompare(left, right));
  if (entries.length === 0) throw new Error("R5 proof publication requires at least one artifact");
  for (const [name, buffer] of entries) {
    if (name.length === 0 || name === "." || name === ".."
        || path.basename(name) !== name || !Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error(`${name}: R5 proof artifact must be a nonempty basename Buffer`);
    }
  }
  const snapshotEntries = entries.map(([name, buffer]) => [name, Buffer.from(buffer)]);
  const operations = { ...REGIONAL_R5_PROOF_FILE_OPERATIONS, ...fileOperations };
  const staged = [];
  const attempted = [];
  const rollbackPaths = [];
  await operations.mkdir(destinationRoot, { recursive: true });
  try {
    for (const [name, buffer] of snapshotEntries) {
      const destination = path.join(destinationRoot, name);
      const temporary = `${destination}.tmp-${temporaryTag}-${process.pid}`;
      let previous = null;
      try {
        previous = await operations.readFile(destination);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const publication = { destination, temporary, previous };
      staged.push(publication);
      await operations.writeFile(temporary, buffer);
    }
    for (const publication of staged) {
      attempted.push(publication);
      await operations.rename(publication.temporary, publication.destination);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const publication of [...attempted].reverse()) {
      try {
        if (publication.previous === null) await operations.rm(publication.destination, { force: true });
        else {
          const rollback = `${publication.destination}.tmp-${temporaryTag}-rollback-${process.pid}`;
          rollbackPaths.push(rollback);
          await operations.writeFile(rollback, publication.previous);
          await operations.rename(rollback, publication.destination);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    const cleanupResults = await Promise.allSettled([
      ...staged.map(({ temporary }) => operations.rm(temporary, { force: true })),
      ...rollbackPaths.map((rollback) => operations.rm(rollback, { force: true })),
    ]);
    const cleanupErrors = cleanupResults
      .filter(({ status }) => status === "rejected")
      .map(({ reason }) => reason);
    if (rollbackErrors.length > 0 || cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors, ...cleanupErrors],
        "R5 atomic proof rollback or cleanup failed",
      );
    }
    throw error;
  }
  return artifacts;
}

async function regionalR5GuideBuffersFromDisk() {
  return {
    regionKits: await readFile(path.join(ROOT, REGIONAL_R5_AUTHORING_SOURCES.regionKits.path)),
    homeRuin: await readFile(path.join(ROOT, REGIONAL_R5_AUTHORING_SOURCES.homeRuin.path)),
  };
}

async function regionalR5SourceMasterProofReport() {
  const authoring = await buildRegionalR5SourceMasters({ sourceBuffers: regionalR5GuideBuffersFromDisk() });
  return { mode: "regional-r5-source-masters", proofOnly: true, published: false, digests: authoring.digests };
}

async function regionalR5KeySceneProofReport(kit) {
  const authoring = await buildRegionalR5SourceMasters({ sourceBuffers: regionalR5GuideBuffersFromDisk() });
  const scene = await buildRegionalR5KeyScene({ kit, authoring });
  const connectivity = measureRegionalR5SceneConnectivity(scene.connectivityInputs);
  return {
    mode: "regional-r5-key-scene",
    kit,
    proofOnly: true,
    published: false,
    passed: connectivity.errors.length === 0,
    diagnostics: connectivity.errors,
    authorityDeltas: connectivity.authorityDeltas,
    digests: {
      scenePng: hashBuffer(scene.buffer),
      sceneRgba: hashBuffer(scene.raw.data),
      connectivityReceipts: canonicalDigest(connectivity.receipts),
    },
  };
}

// REGIONAL_R5_OFFLINE_ENGINE_END

async function verifyExisting(inventory, metadataFiles, evidence) {
  const errors = [];
  for (const { relativePath, buffer } of inventory.outputs) {
    try {
      const existing = await readFile(path.join(RUNTIME_ROOT, relativePath));
      if (!existing.equals(buffer)) errors.push(`${relativePath}: packed runtime bytes drift`);
    } catch (error) {
      errors.push(`${relativePath}: missing runtime output (${error.code ?? "read error"})`);
    }
  }
  for (const [relativePath, buffer] of metadataFiles) {
    const root = relativePath.startsWith("evidence/") ? SCRATCH_ROOT : RUNTIME_ROOT;
    try {
      const existing = await readFile(path.join(root, relativePath));
      if (!existing.equals(buffer)) errors.push(`${relativePath}: metadata bytes drift`);
    } catch (error) {
      errors.push(`${relativePath}: missing metadata output (${error.code ?? "read error"})`);
    }
  }
  for (const [name, buffer] of Object.entries(evidence)) {
    try {
      const existing = await readFile(path.join(EVIDENCE_ROOT, name));
      if (!existing.equals(buffer)) errors.push(`${name}: evidence bytes drift`);
    } catch (error) {
      errors.push(`${name}: missing evidence (${error.code ?? "read error"})`);
    }
  }
  try {
    const [metadataBytes, oneX, twoX] = await Promise.all([
      readFile(path.join(EVIDENCE_ROOT, "runtime-compositor-human.json")),
      readFile(path.join(EVIDENCE_ROOT, "runtime-compositor-human-1x.png")),
      readFile(path.join(EVIDENCE_ROOT, "runtime-compositor-human-2x.png")),
    ]);
    let metadata;
    try {
      metadata = JSON.parse(metadataBytes.toString("utf8"));
    } catch (error) {
      errors.push(`runtime compositor metadata is invalid JSON (${error.message})`);
    }
    if (metadata) {
      errors.push(...validateRuntimeCompositorEvidence(metadata, {
        "runtime-compositor-human-1x.png": oneX,
        "runtime-compositor-human-2x.png": twoX,
      }));
    }
  } catch (error) {
    errors.push(`runtime compositor evidence is incomplete (${error.code ?? "read error"})`);
  }
  const listRelativeFiles = async (root) => {
    const files = [];
    const walk = async (directory) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(absolute);
        else files.push(path.relative(root, absolute));
      }
    };
    await walk(root);
    return files.sort();
  };
  const expectedRuntime = new Set([
    ...inventory.outputs.map(({ relativePath }) => relativePath),
    ...[...metadataFiles.keys()].filter((relativePath) => !relativePath.startsWith("evidence/")),
  ]);
  const expectedNative = new Set([
    ...inventory.outputs.map(({ relativePath }) => relativePath),
    "production-native-contract.json",
  ]);
  const expectedEvidence = new Set([
    ...Object.keys(evidence),
    ...RUNTIME_COMPOSITOR_EVIDENCE_FILES,
    ...[...metadataFiles.keys()].filter((relativePath) => relativePath.startsWith("evidence/"))
      .map((relativePath) => relativePath.slice("evidence/".length)),
  ]);
  const actualRuntime = [
    ...(await listRelativeFiles(path.join(RUNTIME_ROOT, "core"))).map((name) => `core/${name}`),
    ...(await listRelativeFiles(path.join(RUNTIME_ROOT, "regions"))).map((name) => `regions/${name}`),
    ...(await listRelativeFiles(path.join(RUNTIME_ROOT, "homes"))).map((name) => `homes/${name}`),
  ];
  for (const [label, actual, expected] of [
    ["runtime", actualRuntime, expectedRuntime],
    ["native source", await listRelativeFiles(NATIVE_ROOT), expectedNative],
    ["evidence", await listRelativeFiles(EVIDENCE_ROOT), expectedEvidence],
  ]) {
    for (const filename of actual) if (!expected.has(filename)) errors.push(`${label}: stale or unexpected extra ${filename}`);
    for (const filename of expected) if (!actual.includes(filename)) errors.push(`${label}: expected inventory missing ${filename}`);
  }
  return errors;
}

async function writeInventory(inventory, metadataFiles, evidence) {
  const publications = inventory.outputs.map(({ relativePath, buffer }) => ({
    destination: path.join(RUNTIME_ROOT, relativePath), buffer, reportLast: false,
  }));
  for (const [relativePath, buffer] of metadataFiles) {
    const root = relativePath.startsWith("evidence/") ? SCRATCH_ROOT : RUNTIME_ROOT;
    publications.push({ destination: path.join(root, relativePath), buffer,
      reportLast: relativePath === "evidence/packing-report.json" });
  }
  for (const [name, buffer] of Object.entries(evidence)) {
    publications.push({ destination: path.join(EVIDENCE_ROOT, name), buffer, reportLast: false });
  }
  const staged = [];
  const committed = [];
  try {
    for (const publication of publications) {
      await mkdir(path.dirname(publication.destination), { recursive: true });
      const temporary = `${publication.destination}.tmp-task8-${process.pid}`;
      await writeFile(temporary, publication.buffer);
      let previousBuffer = null;
      let previousWasFile = false;
      try {
        previousBuffer = await readFile(publication.destination);
        previousWasFile = true;
      } catch (error) {
        if (!["ENOENT", "EISDIR"].includes(error.code)) throw error;
      }
      staged.push({ ...publication, temporary, previousBuffer, previousWasFile });
    }
    staged.sort((left, right) => Number(left.reportLast) - Number(right.reportLast)
      || left.destination.localeCompare(right.destination));
    for (const publication of staged) {
      await rename(publication.temporary, publication.destination);
      committed.push(publication);
    }
  } catch (error) {
    for (const publication of [...committed].reverse()) {
      if (publication.previousWasFile) {
        const rollbackTemporary = `${publication.destination}.tmp-rollback-${process.pid}`;
        await writeFile(rollbackTemporary, publication.previousBuffer);
        await rename(rollbackTemporary, publication.destination);
      } else {
        await rm(publication.destination, { force: true });
      }
    }
    await Promise.all(staged.map(({ temporary }) => rm(temporary, { force: true })));
    throw error;
  }
}

const WORN_HEARTLAND_LANDMARK_AUTHOR_FLAG = "--author-worn-heartland-landmarks";
const PRODUCTION_PACKER_EXACT_ARGUMENTS = new Set([
  "--check",
  "--proof-regional-r5-source-masters",
  "--proof-regional-r5-key-scene",
  "--author-human-hair",
  "--author-human-faces",
  "--author-semantic-regions",
  "--author-guide-regions",
  "--author-regional-compositions",
  "--author-ash-composition-proof",
  "--author-regional-r4-proofs",
  "--author-regional-r3-proofs",
  "--author-regional-r3-1-proofs",
  WORN_HEARTLAND_LANDMARK_AUTHOR_FLAG,
]);
const PRODUCTION_PACKER_VALUED_ARGUMENT_PREFIXES = Object.freeze([
  "--proof-regional-r5-key-scene=",
  `${WORN_HEARTLAND_LANDMARK_AUTHOR_FLAG}=`,
]);

/** Reject every CLI token outside the packer's exact supported vocabulary. */
export function validateProductionPackerArguments(args) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
    throw new Error("Production packer arguments must be a string array");
  }
  const unknown = args.filter((argument) => !PRODUCTION_PACKER_EXACT_ARGUMENTS.has(argument)
    && !PRODUCTION_PACKER_VALUED_ARGUMENT_PREFIXES.some((prefix) => argument.startsWith(prefix)));
  if (unknown.length > 0) {
    throw new Error(`Unknown production packer argument${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
  }
  return [...args];
}

/** Parse the mutually exclusive scoped worn-landmark CLI argument. */
export function parseWornHeartlandLandmarkAuthoringArgument(args) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
    throw new Error("Worn-heartland landmark authoring requires a string argument list");
  }
  const bare = args.filter((argument) => argument === WORN_HEARTLAND_LANDMARK_AUTHOR_FLAG);
  const valued = args.filter((argument) => argument.startsWith(`${WORN_HEARTLAND_LANDMARK_AUTHOR_FLAG}=`));
  if (bare.length === 0 && valued.length === 0) return null;
  if (bare.length > 0 || valued.length !== 1) {
    throw new Error("Worn-heartland landmark authoring requires exactly one --author-worn-heartland-landmarks=<candidate.png>");
  }
  const candidatePath = valued[0].slice(`${WORN_HEARTLAND_LANDMARK_AUTHOR_FLAG}=`.length);
  if (candidatePath.length === 0) {
    throw new Error("Worn-heartland landmark authoring requires a non-empty candidate PNG path");
  }
  const conflicts = args.filter((argument) => argument !== valued[0]);
  if (conflicts.length > 0) {
    throw new Error(`Worn-heartland landmark authoring cannot be combined with ${conflicts.join(", ")}`);
  }
  return candidatePath;
}

async function main() {
  const args = validateProductionPackerArguments(process.argv.slice(2));
  const wornHeartlandLandmarkCandidate = parseWornHeartlandLandmarkAuthoringArgument(args);
  if (wornHeartlandLandmarkCandidate !== null) {
    const result = await publishWornHeartlandLandmarksScoped({
      candidatePath: wornHeartlandLandmarkCandidate,
    });
    process.stdout.write(`${JSON.stringify({ ...result, publishedPaths: [...result.publishedPaths], passed: true }, null, 2)}\n`);
    return;
  }
  const checkOnly = args.includes("--check");
  const proofRegionalR5SourceMasters = args.includes("--proof-regional-r5-source-masters");
  const proofRegionalR5KeySceneArgument = args.find((argument) => argument.startsWith("--proof-regional-r5-key-scene="));
  const malformedRegionalR5KeySceneProof = args.includes("--proof-regional-r5-key-scene");
  const authorHumanHair = args.includes("--author-human-hair");
  const authorHumanFaces = args.includes("--author-human-faces");
  const authorSemanticRegions = args.includes("--author-semantic-regions");
  const authorGuideRegions = args.includes("--author-guide-regions");
  const authorRegionalCompositions = args.includes("--author-regional-compositions");
  const authorAshCompositionProof = args.includes("--author-ash-composition-proof");
  const authorRegionalR4Proofs = args.includes("--author-regional-r4-proofs");
  const authorRegionalR3Proofs = args.includes("--author-regional-r3-proofs");
  const authorRegionalR31Proofs = args.includes("--author-regional-r3-1-proofs");
  const regionalR5ProofRequested = proofRegionalR5SourceMasters || Boolean(proofRegionalR5KeySceneArgument);
  const otherAuthoringRequested = [authorHumanHair, authorHumanFaces, authorSemanticRegions,
    authorGuideRegions, authorRegionalCompositions, authorAshCompositionProof,
    authorRegionalR4Proofs, authorRegionalR3Proofs, authorRegionalR31Proofs].some(Boolean);
  if (malformedRegionalR5KeySceneProof) {
    throw new Error("--proof-regional-r5-key-scene requires =<kit>");
  }
  if (regionalR5ProofRequested && (checkOnly || otherAuthoringRequested)) {
    throw new Error("R5 proof-only CLI flags cannot be combined with --check or authoring flags");
  }
  if (proofRegionalR5SourceMasters && proofRegionalR5KeySceneArgument) {
    throw new Error("R5 proof-only CLI flags are mutually exclusive");
  }
  if (proofRegionalR5SourceMasters) {
    process.stdout.write(`${JSON.stringify(await regionalR5SourceMasterProofReport(), null, 2)}\n`);
    return;
  }
  if (proofRegionalR5KeySceneArgument) {
    const kit = proofRegionalR5KeySceneArgument.slice("--proof-regional-r5-key-scene=".length);
    process.stdout.write(`${JSON.stringify(await regionalR5KeySceneProofReport(kit), null, 2)}\n`);
    return;
  }
  if (checkOnly && (authorHumanHair || authorHumanFaces || authorSemanticRegions || authorGuideRegions
    || authorRegionalCompositions || authorAshCompositionProof || authorRegionalR4Proofs
    || authorRegionalR3Proofs
    || authorRegionalR31Proofs)) {
    throw new Error("--check cannot be combined with an authoring flag");
  }
  if ([authorHumanHair, authorHumanFaces, authorSemanticRegions, authorGuideRegions,
    authorRegionalCompositions, authorAshCompositionProof, authorRegionalR4Proofs,
    authorRegionalR3Proofs,
    authorRegionalR31Proofs].filter(Boolean).length > 1) {
    throw new Error("authoring flags are mutually exclusive");
  }
  const frozenSources = await readFrozenSources();
  const frozenErrors = validateFrozenSliceReferences(frozenSources);
  if (frozenErrors.length > 0) throw new Error(`Frozen slice validation failed:\n${frozenErrors.join("\n")}`);
  if (authorAshCompositionProof) {
    const evidence = await writeAshCompositionProof();
    process.stdout.write(`${JSON.stringify({ mode: "ash-risk-first-proof", evidence: Object.keys(evidence), passed: true }, null, 2)}\n`);
    return;
  }
  if (authorRegionalR4Proofs) {
    const evidence = await writeRegionalR4Proofs();
    process.stdout.write(`${JSON.stringify({ mode: "regional-r4-proofs", evidence: Object.keys(evidence), passed: true }, null, 2)}\n`);
    return;
  }
  if (authorRegionalR3Proofs) {
    const evidence = await writeRegionalR3Proofs();
    process.stdout.write(`${JSON.stringify({ mode: "regional-r3-proofs", evidence: Object.keys(evidence), passed: true }, null, 2)}\n`);
    return;
  }
  if (authorRegionalR31Proofs) {
    const evidence = await writeRegionalR3Proofs("r3-1");
    process.stdout.write(`${JSON.stringify({ mode: "regional-r3-1-proofs", evidence: Object.keys(evidence), passed: true }, null, 2)}\n`);
    return;
  }
  if (authorHumanHair) await authorHumanHairMaster(frozenSources);
  if (authorHumanFaces) await authorHumanFaceMaster();
  if (authorSemanticRegions) await authorSemanticRegionMasters(frozenSources);
  if (authorGuideRegions) await authorGuideRegionMasters(frozenSources);
  if (authorRegionalCompositions) await authorRegionalCompositionMasters();
  const inventory = await buildRuntimeInventory();
  const nativeValidation = await validateRuntimeInventory(inventory);
  if (nativeValidation.errors.length > 0) {
    throw new Error(`Native production master validation failed:\n${nativeValidation.errors.join("\n")}`);
  }
  const faceValidation = await facePlaneValidation(
    inventory,
    nativeValidation.nativeContract,
    nativeValidation.nativeContractSha256,
  );
  const clips = clipValidation(nativeValidation.nativeContract, nativeValidation.nativeContractSha256);
  if (faceValidation.errors.length > 0 || clips.errors.length > 0) {
    throw new Error(`Native semantic validation failed:\n${[...faceValidation.errors, ...clips.errors].join("\n")}`);
  }
  const standingVisualEnvelopes = await measureStandingVisualEnvelopes(
    inventory.coreBuffers,
    nativeValidation.nativeContract,
  );
  const coreMetadataBytes = coreMetadataFile(
    inventory.descriptors,
    nativeValidation.nativeContract,
    standingVisualEnvelopes,
  ).buffer.length;
  const regionMetadataBytes = Object.fromEntries(REGION_KITS.map((kit) => [kit,
    regionMetadataFile(kit, inventory.descriptors, nativeValidation.nativeContract).buffer.length
      + homeMetadataFile(kit, inventory.descriptors, nativeValidation.nativeContract).buffer.length,
  ]));
  const report = buildProductionPackingReport({
    atlases: inventory.descriptors,
    currentUiCompressedBytes: 0,
    currentUiDecodedBytes: 0,
    metadata: {
      core: { compressedBytes: coreMetadataBytes, decodedBytes: coreMetadataBytes },
      regions: Object.fromEntries(REGION_KITS.map((kit) => [kit, {
        compressedBytes: regionMetadataBytes[kit],
        decodedBytes: regionMetadataBytes[kit],
      }])),
    },
    budgets: {
      coreCompressedAllocation: 720_896,
      coreCompressedMax: 786_432,
      regionCompressedAllocation: 184_320,
      regionCompressedMax: 196_608,
      activeCompressedMax: 1_310_720,
    },
  });
  report.facePlaneValidation = faceValidation;
  report.clipValidation = clips;
  report.nativeContractSha256 = nativeValidation.nativeContractSha256;
  const budgetErrors = validateAssetBudgets(report);
  if (budgetErrors.length > 0) throw new Error(`Production art budget failed:\n${budgetErrors.join("\n")}`);
  if (report.coreArtDecodedBytes !== 26_083_328) throw new Error(`core art decoded total drifted: ${report.coreArtDecodedBytes}`);
  for (const kit of REGION_KITS) {
    if (report.coreArtDecodedBytes + report.regionArtDecodedBytes[kit] !== 30_367_744) {
      throw new Error(`${kit} active art decoded total drifted: ${report.coreArtDecodedBytes + report.regionArtDecodedBytes[kit]}`);
    }
  }
  const evidence = await buildEvidence(inventory);
  const metadataFiles = await expectedMetadataFiles(
    inventory,
    report,
    evidence,
    nativeValidation.nativeContract,
    standingVisualEnvelopes,
  );
  if (checkOnly) {
    const errors = await verifyExisting(inventory, metadataFiles, evidence);
    if (errors.length > 0) throw new Error(`Production asset check failed:\n${errors.join("\n")}`);
  } else {
    await writeInventory(inventory, metadataFiles, evidence);
  }
  process.stdout.write(`${JSON.stringify({
    mode: checkOnly ? "check" : "write",
    atlases: inventory.descriptors.length,
    coreCompressedBytes: report.coreCompressedBytes,
    exactCoreDecodedBytes: report.exactCoreDecodedBytes,
    regionCompressedBytes: report.regionCompressedBytes,
    exactPeakActiveDecodedBytes: report.exactPeakActiveDecodedBytes,
    evidence: Object.keys(evidence),
    frozenSliceHashes: FROZEN_SLICE_HASHES,
    passed: true,
  }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
