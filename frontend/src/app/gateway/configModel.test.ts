import { describe, expect, it } from "vitest";

import {
  configNotices,
  rollSeed,
  setAbundance,
  setBeingCount,
  setBeingName,
  setBeingPersona,
  setBeingRegion,
  setDuration,
  setMaxOffspring,
  setProvider,
  setReflectEveryNBreaths,
  setSeed,
  setUniformEnergy,
  setUniformMaterials,
  uniformStock,
} from "./configModel";
import { parseRunDefaults, type RunConfig, type RunDefaults } from "./runConfig";

/**
 * A `/api/run/defaults` body in the shape the server sends, with bounds chosen
 * to exercise clamping (a 5-step energy knob, a small seed span) rather than to
 * mirror today's world numbers.
 */
function defaultsPayload(): Record<string, unknown> {
  return {
    schema: 1,
    defaults: {
      beings: [
        { name: "Joe", start_region: "warm_springs", energy: 100, materials: 45 },
        { name: "Mae", start_region: "warm_springs", energy: 100, materials: 45 },
        { name: "Dick", start_region: "nirvana", energy: 100, materials: 45 },
        { name: "Allen", start_region: "nirvana", energy: 100, materials: 45 },
      ],
      abundance: 1,
      seed: 7,
      duration_seconds: 1800,
      provider: "gemini",
      reflect_every_n_breaths: 12,
      max_offspring: 5,
    },
    knobs: {
      beings: {
        label: "How many beings",
        min_count: 1,
        max_count: 12,
        default_count: 4,
        fields: {
          energy: { label: "Starting energy", min: 50, max: 200, step: 5 },
          materials: {
            label: "Starting materials",
            min: 0,
            max: 100,
            step: 1,
            markers: [
              { at: 30, label: "a child" },
              { at: 80, label: "a home" },
            ],
          },
        },
      },
      abundance: { label: "Abundance", min: 0.25, max: 3, step: 0.05 },
      seed: { label: "Land shape", min: 0, max: 999999, step: 1 },
      max_offspring: { label: "Children per being", min: 0, max: 10, step: 1 },
      duration_seconds: {
        label: "How long",
        choices: [
          { value: 900, label: "15 minutes" },
          { value: 1800, label: "30 minutes" },
          { value: null, label: "until stopped" },
        ],
      },
      provider: {
        label: "Where the minds run",
        choices: [
          { value: "gemini", label: "the cloud" },
          { value: "ollama", label: "this machine" },
        ],
      },
      reflect_every_n_breaths: {
        label: "Reflection",
        choices: [
          { value: 6, label: "every 6" },
          { value: 12, label: "every 12" },
          { value: 24, label: "every 24" },
        ],
      },
    },
    regions: [
      { name: "warm_springs", description: "richest", energy_rate: 0.25, materials_rate: 0.2 },
      { name: "nirvana", description: "thinning", energy_rate: 0.2, materials_rate: 0.2 },
      { name: "nirvana_east", description: "near-barren", energy_rate: 0.1, materials_rate: 0.1 },
      { name: "nirvana_west", description: "all but dead", energy_rate: 0.05, materials_rate: 0 },
    ],
    locked: { world_tick_interval_seconds: 5 },
  };
}

function defaults(): RunDefaults {
  return parseRunDefaults(defaultsPayload());
}

function draft(): RunConfig {
  return defaults().config;
}

describe("setBeingCount", () => {
  it("adds beings carrying the roster's current stock", () => {
    const withStock = setUniformMaterials(draft(), defaults(), 61);

    const grown = setBeingCount(withStock, defaults(), 6);

    expect(grown.beings).toHaveLength(6);
    expect(grown.beings.every((being) => being.materials === 61)).toBe(true);
    expect(grown.beings[4]?.energy).toBe(100);
  });

  it("names beings beyond the authored founders without inventing a character", () => {
    const grown = setBeingCount(draft(), defaults(), 6);

    expect(grown.beings.slice(0, 4).map((being) => being.name)).toEqual([
      "Joe",
      "Mae",
      "Dick",
      "Allen",
    ]);
    expect(grown.beings[4]?.name).toBe("Fifth");
    expect(grown.beings[5]?.name).toBe("Sixth");
    expect(grown.beings[4]?.persona).toBeNull();
  });

  it("spreads new beings across the designed regions rather than piling them up", () => {
    const grown = setBeingCount(draft(), defaults(), 8);

    expect(grown.beings.slice(4).map((being) => being.start_region)).toEqual([
      "warm_springs",
      "nirvana",
      "nirvana_east",
      "nirvana_west",
    ]);
  });

  it("drops from the end and never below the knob floor", () => {
    const edited = setBeingName(draft(), 0, "Wren");

    const shrunk = setBeingCount(edited, defaults(), 0);

    expect(shrunk.beings).toHaveLength(1);
    expect(shrunk.beings[0]?.name).toBe("Wren");
  });

  it("never exceeds the knob ceiling", () => {
    expect(setBeingCount(draft(), defaults(), 99).beings).toHaveLength(12);
  });

  it("keeps every edit made to the beings that survive", () => {
    const edited = setBeingPersona(draft(), 2, "Keeper of the low fires.");

    const cycled = setBeingCount(setBeingCount(edited, defaults(), 9), defaults(), 4);

    expect(cycled.beings[2]?.persona).toBe("Keeper of the low fires.");
  });
});

describe("uniform stock", () => {
  it("clamps to the knob and applies to every being at once", () => {
    const config = setUniformEnergy(setBeingCount(draft(), defaults(), 6), defaults(), 10_000);

    expect(config.beings.every((being) => being.energy === 200)).toBe(true);
    expect(uniformStock(config).energy).toBe(200);
  });

  it("snaps to the knob's step", () => {
    expect(setUniformEnergy(draft(), defaults(), 103).beings[0]?.energy).toBe(105);
  });

  it("reports varied stock rather than pretending it is uniform", () => {
    const config = draft();
    const mixed: RunConfig = {
      ...config,
      beings: config.beings.map((being, index) => (
        index === 0 ? { ...being, materials: 12 } : being
      )),
    };

    expect(uniformStock(mixed).materials).toBeNull();
    expect(uniformStock(mixed).energy).toBe(100);
  });
});

describe("per-being edits", () => {
  it("renames one being only", () => {
    const config = setBeingName(draft(), 1, "  Wren  ");

    expect(config.beings[1]?.name).toBe("Wren");
    expect(config.beings[0]?.name).toBe("Joe");
  });

  it("refuses a region the world does not have", () => {
    const config = setBeingRegion(draft(), defaults(), 0, "atlantis");

    expect(config.beings[0]?.start_region).toBe("warm_springs");
  });

  it("moves a being to a designed region", () => {
    expect(setBeingRegion(draft(), defaults(), 0, "nirvana_west").beings[0]?.start_region)
      .toBe("nirvana_west");
  });

  it("treats a blank persona as none written", () => {
    const written = setBeingPersona(draft(), 0, "A keeper of fires.");

    expect(written.beings[0]?.persona).toBe("A keeper of fires.");
    expect(setBeingPersona(written, 0, "   ").beings[0]?.persona).toBeNull();
  });

  it("ignores an index that is not on the roster", () => {
    expect(setBeingName(draft(), 40, "Ghost")).toEqual(draft());
  });
});

describe("world knobs", () => {
  it("clamps abundance to the measured band and snaps to its step", () => {
    expect(setAbundance(draft(), defaults(), 9).abundance).toBe(3);
    expect(setAbundance(draft(), defaults(), 0).abundance).toBe(0.25);
    expect(setAbundance(draft(), defaults(), 1.13).abundance).toBeCloseTo(1.15, 6);
  });

  it("clamps the seed and keeps it whole", () => {
    expect(setSeed(draft(), defaults(), -4).seed).toBe(0);
    expect(setSeed(draft(), defaults(), 12.7).seed).toBe(13);
  });

  it("rolls a seed inside the knob from an injected source", () => {
    expect(rollSeed(draft(), defaults(), () => 0).seed).toBe(0);
    expect(rollSeed(draft(), defaults(), () => 0.5).seed).toBe(500_000);
    expect(rollSeed(draft(), defaults(), () => 0.999999999).seed).toBe(999_999);
  });

  it("accepts only offered choices", () => {
    expect(setDuration(draft(), defaults(), 900).duration_seconds).toBe(900);
    expect(setDuration(draft(), defaults(), null).duration_seconds).toBeNull();
    expect(setDuration(draft(), defaults(), 12).duration_seconds).toBe(1800);
    expect(setProvider(draft(), defaults(), "ollama").provider).toBe("ollama");
    expect(setProvider(draft(), defaults(), "gpt").provider).toBe("gemini");
    expect(setReflectEveryNBreaths(draft(), defaults(), 24).reflect_every_n_breaths).toBe(24);
    expect(setReflectEveryNBreaths(draft(), defaults(), 7).reflect_every_n_breaths).toBe(12);
  });

  it("clamps children per being", () => {
    expect(setMaxOffspring(draft(), defaults(), 40).max_offspring).toBe(10);
    expect(setMaxOffspring(draft(), defaults(), -1).max_offspring).toBe(0);
  });
});

describe("configNotices", () => {
  it("says nothing about a roster that begins with company", () => {
    expect(configNotices(draft(), defaults())).toEqual([]);
  });

  it("warns gently when every being begins alone", () => {
    let config = setBeingCount(draft(), defaults(), 4);
    config = setBeingRegion(config, defaults(), 0, "warm_springs");
    config = setBeingRegion(config, defaults(), 1, "nirvana");
    config = setBeingRegion(config, defaults(), 2, "nirvana_east");
    config = setBeingRegion(config, defaults(), 3, "nirvana_west");

    const notices = configNotices(config, defaults());

    expect(notices).toHaveLength(1);
    expect(notices[0]?.id).toBe("all-alone");
    expect(notices[0]?.tone).toBe("caution");
    expect(notices[0]?.message).toMatch(/alone/i);
  });

  it("does not warn a single being for being by itself", () => {
    const config = setBeingCount(draft(), defaults(), 1);

    expect(configNotices(config, defaults()).map((notice) => notice.id))
      .not.toContain("all-alone");
  });

  it("warns when no being can afford to put a child into the world", () => {
    const config = setUniformMaterials(draft(), defaults(), 10);

    expect(configNotices(config, defaults()).map((notice) => notice.id))
      .toContain("below-mating-floor");
  });

  it("warns when the land is set to dying", () => {
    const config = setAbundance(draft(), defaults(), 0.25);

    expect(configNotices(config, defaults()).map((notice) => notice.id))
      .toContain("thin-land");
  });

  it("says nothing about markers the server did not publish", () => {
    const payload = defaultsPayload();
    const knobs = payload.knobs as Record<string, Record<string, unknown>>;
    const fields = knobs.beings?.fields as Record<string, Record<string, unknown>>;
    delete fields.materials?.markers;
    const bare = parseRunDefaults(payload);

    expect(configNotices(setUniformMaterials(draft(), bare, 0), bare)
      .map((notice) => notice.id)).not.toContain("below-mating-floor");
  });
});
