/** Export every actual production recipe once at run startup; no browser or model calls. */
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const args = process.argv.slice(2);
const inputPath = args[args.indexOf("--input") + 1];
const outputPath = args[args.indexOf("--output") + 1];
if (!args.includes("--input") || !args.includes("--output") || !inputPath || !outputPath) {
  throw new Error("Usage: node scripts/export-navigation.mjs --input world.json --output navigation.json");
}
const input = JSON.parse(await readFile(inputPath, "utf8"));
validateInput(input);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", logLevel: "error" });
try {
  const p = "/src/renderer2d/production";
  const { createRegionMapIdentity } = await server.ssrLoadModule(`${p}/maps/RegionMapIdentity.ts`);
  const { createProductionRegionMapRecipe } = await server.ssrLoadModule(`${p}/maps/ProductionRegionMapRecipe.ts`);
  const { createSpatialNavigationBundle } = await server.ssrLoadModule(`${p}/navigation/SpatialNavigationExport.ts`);
  const pressures = resolveInitialPressures(input);
  const maps = input.regions.map((region) => {
    const initialPressure = pressures.get(region.name);
    if (initialPressure === undefined) {
      throw new Error(`Missing initial_pressures entry for region ${region.name}`);
    }
    const identity = createRegionMapIdentity(input.seed, region, input.regions);
    return {
      recipe: createProductionRegionMapRecipe(identity, initialPressure),
      initialPressure,
    };
  });
  await writeFile(outputPath, `${JSON.stringify(createSpatialNavigationBundle(maps))}\n`, "utf8");
} finally {
  await server.close();
}

function validateInput(input) {
  if (!isRecord(input)) throw new Error("Spatial export input must be a JSON object");
  if (!Number.isSafeInteger(input.seed)) throw new Error("Invalid spatial seed");
  if (!Array.isArray(input.regions) || input.regions.length === 0) {
    throw new Error("Spatial export input must contain at least one region");
  }
  const names = new Set();
  input.regions.forEach((region, index) => {
    if (!isRecord(region)) throw new Error(`Spatial export region ${index + 1} must be an object`);
    if (typeof region.name !== "string" || region.name.length === 0) {
      throw new Error(`Spatial export region ${index + 1} must have a non-empty name`);
    }
    if (names.has(region.name)) throw new Error(`Duplicate spatial export region ${region.name}`);
    names.add(region.name);
    if (typeof region.description !== "string") {
      throw new Error(`Spatial export region ${region.name} must have a description`);
    }
    if (!Array.isArray(region.connections) || region.connections.some((destination) => typeof destination !== "string")) {
      throw new Error(`Spatial export region ${region.name} connections must be string ids`);
    }
    for (const field of ["energy_rate", "materials_rate", "current_energy", "current_materials", "max_energy", "max_materials"]) {
      if (typeof region[field] !== "number" || !Number.isFinite(region[field])) {
        throw new Error(`Spatial export region ${region.name} ${field} must be finite`);
      }
    }
  });
  for (const region of input.regions) {
    for (const destination of region.connections) {
      if (!names.has(destination)) {
        throw new Error(`Spatial export region ${region.name} references unknown connection ${destination}`);
      }
    }
  }
  if (input.initial_pressures !== undefined && !isRecord(input.initial_pressures)) {
    throw new Error("initial_pressures must be keyed by region id");
  }
  if (input.initial_pressures === undefined && input.initial_pressure === undefined) {
    throw new Error("Spatial export input requires initial_pressures keyed by region id");
  }
  if (input.initial_pressures !== undefined && input.initial_pressure !== undefined) {
    throw new Error("Provide initial_pressures or legacy initial_pressure, not both");
  }
}

function resolveInitialPressures(input) {
  const values = input.initial_pressures ?? (
    input.regions.length === 1
      ? { [input.regions[0].name]: input.initial_pressure }
      : (() => {
          throw new Error("Legacy initial_pressure is supported only for one-region inputs; use initial_pressures keyed by region id");
        })()
  );
  const knownRegions = new Set(input.regions.map((region) => region.name));
  const pressures = new Map();
  for (const name of Object.keys(values)) {
    if (!knownRegions.has(name)) throw new Error(`initial_pressures contains unknown region ${name}`);
    pressures.set(name, validatePressure(values[name], name));
  }
  for (const region of input.regions) {
    if (!pressures.has(region.name)) throw new Error(`Missing initial_pressures entry for region ${region.name}`);
  }
  return pressures;
}

function validatePressure(value, regionName) {
  if (!isRecord(value)
      || !Number.isSafeInteger(value.populationHighWater)
      || value.populationHighWater < 0
      || !Number.isSafeInteger(value.builtFootprintHighWater)
      || value.builtFootprintHighWater < 0) {
    throw new Error(`Invalid initial spatial map pressure for region ${regionName}`);
  }
  return Object.freeze({
    populationHighWater: value.populationHighWater,
    builtFootprintHighWater: value.builtFootprintHighWater,
  });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
