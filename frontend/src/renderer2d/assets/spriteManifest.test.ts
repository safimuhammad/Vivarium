import { describe, expect, it } from "vitest";

import { DEMO_HUMAN_MANIFEST } from "./demoManifest";
import { validateSpriteManifest, type SpriteManifest } from "./spriteManifest";

const mutate = (fn: (copy: any) => void): SpriteManifest => {
  const copy = structuredClone(DEMO_HUMAN_MANIFEST);
  fn(copy);
  return copy;
};

describe("sprite manifest", () => {
  it("keeps frames, anchors, markers, and stride inside the atlas", () => {
    expect(validateSpriteManifest(DEMO_HUMAN_MANIFEST)).toEqual([]);
  });

  it.each([
    ["out-of-bounds frame", (m: any) => { m.layers[0].clips.idle_south.frames[0].rect.x = 9999; }],
    ["non-positive duration", (m: any) => { m.layers[0].clips.idle_south.frames[0].durationMs = 0; }],
    ["missing walk stride", (m: any) => { delete m.layers[0].clips.walk_south.strideLength; }],
    ["invalid face overlay anchor", (m: any) => { m.faceAnchor.x = 48; }],
    ["invalid held overlay anchor", (m: any) => { m.heldAnchor.y = 65; }],
    ["invalid marker index", (m: any) => { m.layers[0].clips.walk_south.markers[0].frame = 99; }],
    ["non-native frame size", (m: any) => { m.layers[0].clips.idle_south.frames[0].rect.width = 47; }],
    ["fractional frame origin", (m: any) => { m.layers[0].clips.idle_south.frames[0].rect.x = 0.5; }],
    ["non-cell-aligned frame origin", (m: any) => { m.layers[0].clips.idle_south.frames[0].rect.x = 1; }],
    ["NaN frame origin", (m: any) => { m.layers[0].clips.idle_south.frames[0].rect.x = Number.NaN; }],
    ["infinite duration", (m: any) => { m.layers[0].clips.idle_south.frames[0].durationMs = Number.POSITIVE_INFINITY; }],
    ["fractional duration", (m: any) => { m.layers[0].clips.idle_south.frames[0].durationMs = 12.5; }],
    ["infinite stride", (m: any) => { m.layers[0].clips.walk_south.strideLength = Number.POSITIVE_INFINITY; }],
    ["missing body layer", (m: any) => { m.layers = m.layers.filter((layer: any) => layer.id !== "body"); }],
    ["duplicate face layer", (m: any) => { m.layers.push(structuredClone(m.layers.find((layer: any) => layer.id === "face"))); }],
    ["unknown fourth layer", (m: any) => { const layer = structuredClone(m.layers[0]); layer.id = "other"; m.layers.push(layer); }],
    ["mismatched held atlas", (m: any) => { m.layers.find((layer: any) => layer.id === "held").atlasId = "human-face"; }],
    ["walk semantics from clip id", (m: any) => {
      const body = m.layers.find((layer: any) => layer.id === "body");
      body.clips.stroll_south = body.clips.walk_south;
      delete body.clips.walk_south;
      delete body.clips.stroll_south.strideLength;
    }],
  ])("rejects %s", (_label, change) => {
    expect(validateSpriteManifest(mutate(change))).not.toEqual([]);
  });

  it("does not infer walk semantics from a record key", () => {
    const manifest = mutate((m) => {
      const body = m.layers.find((layer: any) => layer.id === "body");
      body.clips.walk_named_key = structuredClone(body.clips.idle_south);
      body.clips.walk_named_key.id = "idle_alias";
    });
    expect(validateSpriteManifest(manifest)).toEqual([]);
  });

  it("keeps work on the held channel while the body remains locomotion-only", () => {
    const body = DEMO_HUMAN_MANIFEST.layers.find((layer) => layer.id === "body");
    const held = DEMO_HUMAN_MANIFEST.layers.find((layer) => layer.id === "held");
    expect(body?.clips.work).toBeUndefined();
    expect(held?.clips.work).toBeDefined();
  });

  it("declares the exact native directional animation inventory with distinct source cells", () => {
    const body = DEMO_HUMAN_MANIFEST.layers.find((layer) => layer.id === "body")!;
    for (const direction of ["north", "east", "south", "west"] as const) {
      const expected = {
        [`idle_${direction}`]: 4,
        [`walk_${direction}`]: 6,
        [`turn_${direction}`]: 2,
        [`stop_${direction}`]: 2,
      } as const;
      const rectangles = new Set<string>();
      for (const [clipId, count] of Object.entries(expected)) {
        const frames = body.clips[clipId]?.frames;
        expect(frames, clipId).toHaveLength(count);
        for (const { rect } of frames ?? []) rectangles.add(`${rect.x},${rect.y},${rect.width},${rect.height}`);
      }
      expect(rectangles.size, `${direction} clips must not reuse source cells`).toBe(14);
      expect(body.clips[`idle_${direction}`]!.frames.every(({ durationMs }) => durationMs >= 220 && durationMs <= 280)).toBe(true);
      expect(body.clips[`turn_${direction}`]!.frames.reduce((sum, { durationMs }) => sum + durationMs, 0)).toBe(120);
      expect(body.clips[`stop_${direction}`]!.frames.reduce((sum, { durationMs }) => sum + durationMs, 0)).toBe(120);
    }
  });

  it("binds every face expression to south, west, north, and east atlas rows", () => {
    const face = DEMO_HUMAN_MANIFEST.layers.find((layer) => layer.id === "face")!;
    const expressions = ["neutral", "blink_1", "blink_2", "talk_1", "talk_2", "weary", "hurt", "recovery"];
    const directions = ["south", "west", "north", "east"] as const;
    for (const [row, direction] of directions.entries()) {
      for (const [column, expression] of expressions.entries()) {
        const clipId = `${expression}_${direction}`;
        const clip = face.clips[clipId];
        expect(clip, clipId).toBeDefined();
        expect(clip?.direction).toBe(direction);
        expect(clip?.frames[0]?.rect).toEqual({ x: column * 48, y: row * 64, width: 48, height: 64 });
      }
    }
    expect(face.clips.neutral).toBeUndefined();
  });

  it("accepts the final aligned body cell in the widened atlas", () => {
    const manifest = mutate((m) => {
      const body = m.layers.find((layer: any) => layer.id === "body");
      body.clips.idle_south.frames[0].rect.x = 13 * 48;
    });
    expect(validateSpriteManifest(manifest)).toEqual([]);
  });

  it("rejects the first aligned body cell beyond the widened atlas", () => {
    const manifest = mutate((m) => {
      const body = m.layers.find((layer: any) => layer.id === "body");
      body.clips.idle_south.frames[0].rect.x = 14 * 48;
    });
    expect(validateSpriteManifest(manifest)).toContainEqual(expect.stringMatching(/frame outside atlas/));
  });
});
