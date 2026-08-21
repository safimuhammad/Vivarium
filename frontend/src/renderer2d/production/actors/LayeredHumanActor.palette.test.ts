import { describe, expect, it, vi } from "vitest";

import {
  CLOTHING_PALETTES,
  HAIR_RAMPS,
  PERSONA_ACCENTS,
  SKIN_RAMPS,
  type HumanAppearance,
} from "./appearance";

const appearanceHarness = vi.hoisted(() => ({
  current: {
    rig: "human-a",
    skinRamp: "porcelain",
    hairSilhouette: "crop",
    hairRamp: "espresso",
    clothingSilhouette: "work-shirt-sash",
    clothingPalette: "olive",
    secondaryAccent: null,
  },
}));

vi.mock("./appearance", async (importOriginal) => {
  const original = await importOriginal<typeof import("./appearance")>();
  return {
    ...original,
    deriveHumanAppearance: () => Object.freeze({ ...appearanceHarness.current }),
  };
});

import {
  PRODUCTION_ASSET_MANIFEST,
  type ProductionAssetLease,
} from "../assets/productionManifest";
import { LayeredHumanActor } from "./LayeredHumanActor";

interface FakeBitmap extends ImageBitmap {
  readonly atlasId: string;
}

type PaintOperation = Readonly<{
  kind: "image" | "fill" | "stroke";
  atlasId: string | null;
  args: readonly number[];
  filter: string;
  composite: GlobalCompositeOperation;
  alpha: number;
  paint: string;
}>;

class PaintContext {
  imageSmoothingEnabled = true;
  filter = "none";
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  globalAlpha = 1;
  fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  strokeStyle: string | CanvasGradient | CanvasPattern = "#000000";
  readonly operations: PaintOperation[] = [];
  readonly #stack: Array<Readonly<{
    filter: string;
    composite: GlobalCompositeOperation;
    alpha: number;
    fill: string | CanvasGradient | CanvasPattern;
    stroke: string | CanvasGradient | CanvasPattern;
  }>> = [];

  get saveDepth(): number {
    return this.#stack.length;
  }

  save(): void {
    this.#stack.push({
      filter: this.filter,
      composite: this.globalCompositeOperation,
      alpha: this.globalAlpha,
      fill: this.fillStyle,
      stroke: this.strokeStyle,
    });
  }

  restore(): void {
    const value = this.#stack.pop();
    if (!value) throw new Error("Canvas restore without matching save.");
    this.filter = value.filter;
    this.globalCompositeOperation = value.composite;
    this.globalAlpha = value.alpha;
    this.fillStyle = value.fill;
    this.strokeStyle = value.stroke;
  }

  drawImage(image: CanvasImageSource, ...args: number[]): void {
    this.operations.push(this.#operation("image", (image as FakeBitmap).atlasId, args, ""));
  }

  fillRect(...args: number[]): void {
    this.operations.push(this.#operation("fill", null, args, String(this.fillStyle)));
  }

  strokeRect(...args: number[]): void {
    this.operations.push(this.#operation("stroke", null, args, String(this.strokeStyle)));
  }

  #operation(
    kind: PaintOperation["kind"],
    atlasId: string | null,
    args: readonly number[],
    paint: string,
  ): PaintOperation {
    return {
      kind,
      atlasId,
      args: [...args],
      filter: this.filter,
      composite: this.globalCompositeOperation,
      alpha: this.globalAlpha,
      paint,
    };
  }
}

function leases(): ReadonlyMap<string, ProductionAssetLease> {
  return new Map(Object.values(PRODUCTION_ASSET_MANIFEST.atlases)
    .filter(({ group }) => group === "core")
    .map(({ id }) => [id, {
      value: { atlasId: id } as FakeBitmap,
      release: vi.fn(),
    }]));
}

function render(appearance: HumanAppearance): Readonly<{
  context: PaintContext;
  channels: Readonly<Record<string, readonly PaintOperation[]>>;
}> {
  appearanceHarness.current = { ...appearance } as typeof appearanceHarness.current;
  const actor = new LayeredHumanActor({
    id: "palette_probe",
    name: "Palette Probe",
    position: { x: 96, y: 128 },
    facing: "east",
    manifest: PRODUCTION_ASSET_MANIFEST,
    atlasLeases: leases(),
  });
  const context = new PaintContext();
  actor.draw(context as unknown as CanvasRenderingContext2D);
  const atlas = PRODUCTION_ASSET_MANIFEST.human.layerAtlases;
  const channels: Record<string, PaintOperation[]> = {
    body: [],
    face: [],
    hair: [],
    clothing: [],
    held: [],
    status: [],
    accent: [],
  };
  for (const operation of context.operations) {
    let channel = "accent";
    if (operation.atlasId === atlas.body) channel = "body";
    else if (operation.atlasId === atlas.face) channel = "face";
    else if (operation.atlasId === atlas.hair) channel = "hair";
    else if (operation.atlasId?.startsWith("core-human-clothing-")) channel = "clothing";
    else if (operation.atlasId === atlas.held) channel = "held";
    else if (operation.atlasId === atlas.status) channel = "status";
    channels[channel]!.push(operation);
  }
  return { context, channels };
}

const baseAppearance = (): HumanAppearance => ({
  rig: "human-a",
  skinRamp: "porcelain",
  hairSilhouette: "crop",
  hairRamp: "espresso",
  clothingSilhouette: "work-shirt-sash",
  clothingPalette: "olive",
  secondaryAccent: null,
});

const signatures = (
  values: readonly string[],
  makeAppearance: (value: string) => HumanAppearance,
  channel: string,
): readonly string[] => values.map((value) => JSON.stringify(render(makeAppearance(value)).channels[channel]));

describe("LayeredHumanActor rendered appearance channels", () => {
  it("renders all six skin ramps distinctly on body and face only", () => {
    const renders = SKIN_RAMPS.map((skinRamp) => render({ ...baseAppearance(), skinRamp }));
    expect(new Set(renders.map(({ channels }) => JSON.stringify(channels.body)))).toHaveLength(6);
    expect(new Set(renders.map(({ channels }) => JSON.stringify(channels.face)))).toHaveLength(6);
    for (const channel of ["hair", "clothing", "held", "status", "accent"] as const) {
      expect(new Set(renders.map(({ channels }) => JSON.stringify(channels[channel]))), channel).toHaveLength(1);
    }
  });

  it("renders all six hair ramps distinctly on the hair channel only", () => {
    const renders = HAIR_RAMPS.map((hairRamp) => render({ ...baseAppearance(), hairRamp }));
    expect(new Set(renders.map(({ channels }) => JSON.stringify(channels.hair)))).toHaveLength(6);
    for (const channel of ["body", "face", "clothing", "held", "status", "accent"] as const) {
      expect(new Set(renders.map(({ channels }) => JSON.stringify(channels[channel]))), channel).toHaveLength(1);
    }
  });

  it("renders all eight clothing palettes distinctly on the clothing channel only", () => {
    const rendered = signatures(
      CLOTHING_PALETTES,
      (clothingPalette) => ({
        ...baseAppearance(),
        clothingPalette: clothingPalette as HumanAppearance["clothingPalette"],
      }),
      "clothing",
    );
    expect(new Set(rendered)).toHaveLength(8);
  });

  it("renders each persona accent as one small distinct integer mark without changing primary layers", () => {
    const without = render(baseAppearance());
    expect(without.channels.accent).toEqual([]);
    const accented = PERSONA_ACCENTS.map((secondaryAccent) => render({
      ...baseAppearance(),
      secondaryAccent,
    }));
    expect(new Set(accented.map(({ channels }) => JSON.stringify(channels.accent)))).toHaveLength(4);
    for (const { context, channels } of accented) {
      expect(channels.accent.length).toBeGreaterThan(0);
      for (const operation of channels.accent) {
        expect(operation.args.every(Number.isInteger)).toBe(true);
        if (operation.args.length >= 4) expect(operation.args[2]! * operation.args[3]!).toBeLessThanOrEqual(16);
      }
      for (const channel of ["body", "face", "hair", "clothing", "held", "status"] as const) {
        expect(channels[channel], channel).toEqual(without.channels[channel]);
      }
      expect(context.imageSmoothingEnabled).toBe(false);
      expect(context.saveDepth).toBe(0);
      expect(context.filter).toBe("none");
      expect(context.globalCompositeOperation).toBe("source-over");
      expect(context.globalAlpha).toBe(1);
    }
  });
});
