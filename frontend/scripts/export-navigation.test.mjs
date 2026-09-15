import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts/export-navigation.mjs");
const regions = [
  region("nirvana", "a once-heavenly landscape, now thinning and picked-over", ["warm_springs", "nirvana_east", "nirvana_west"]),
  region("nirvana_east", "a struggling, near-barren stretch", ["warm_springs", "nirvana"]),
  region("nirvana_west", "a nuclear wasteland, all but dead", ["warm_springs", "nirvana"]),
  region("warm_springs", "hot spring lakes", ["nirvana_west", "nirvana_east", "nirvana"]),
];

test("CLI emits a v2 bundle from keyed per-region pressure", async () => {
  await withTempFiles(async (inputPath, outputPath) => {
    await writeFile(inputPath, JSON.stringify({
      seed: 41,
      regions,
      initial_pressures: {
        nirvana: { populationHighWater: 4, builtFootprintHighWater: 0 },
        nirvana_east: { populationHighWater: 8, builtFootprintHighWater: 1 },
        nirvana_west: { populationHighWater: 2, builtFootprintHighWater: 0 },
        warm_springs: { populationHighWater: 16, builtFootprintHighWater: 3 },
      },
    }));
    await runExporter(inputPath, outputPath);
    const bundle = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(bundle.version, 2);
    assert.deepEqual(bundle.regions.map(({ region_id }) => region_id), regions.map(({ name }) => name));
    assert.deepEqual(
      bundle.regions.find(({ region_id }) => region_id === "nirvana_west").initial_pressure,
      { populationHighWater: 2, builtFootprintHighWater: 0 },
    );
    for (const map of bundle.regions) {
      for (const gate of map.gates) {
        const landmarkId = gate.role === "departure"
          ? `gate-${gate.to_region}`
          : `arrival-${gate.from_region}`;
        const landmark = map.landmarks.find(({ id }) => id === landmarkId);
        assert.ok(landmark, `${map.region_id} ${landmarkId}`);
        assert.deepEqual({ x: landmark.x, y: landmark.y }, { x: gate.x, y: gate.y });
        assert.ok(landmark.affordances.includes(gate.role === "departure" ? "exit" : "entrance"));
      }
    }
  });
});

test("CLI accepts legacy pressure for a one-region input", async () => {
  await withTempFiles(async (inputPath, outputPath) => {
    await writeFile(inputPath, JSON.stringify({
      seed: 41,
      regions: [{ ...regions[0], connections: [] }],
      initial_pressure: { populationHighWater: 4, builtFootprintHighWater: 0 },
    }));
    await runExporter(inputPath, outputPath);
    const bundle = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(bundle.version, 2);
    assert.equal(bundle.regions.length, 1);
    assert.deepEqual(bundle.regions[0].initial_pressure, {
      populationHighWater: 4,
      builtFootprintHighWater: 0,
    });
  });
});

async function runExporter(inputPath, outputPath) {
  await execFileAsync(process.execPath, [script, "--input", inputPath, "--output", outputPath], {
    cwd: root,
    env: { ...process.env, PATH: `/opt/homebrew/opt/node@22/bin:${process.env.PATH ?? ""}` },
  });
}

async function withTempFiles(callback) {
  const directory = await mkdtemp(path.join(tmpdir(), "vivarium-navigation-export-"));
  try {
    await callback(path.join(directory, "input.json"), path.join(directory, "output.json"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function region(name, description, connections) {
  return {
    name,
    description,
    connections,
    energy_rate: name === "nirvana_west" ? 0.05 : 0.2,
    materials_rate: name === "nirvana_west" ? 0 : 0.2,
    current_energy: 40,
    current_materials: name === "nirvana_west" ? 0 : 40,
    max_energy: 100,
    max_materials: 100,
  };
}
