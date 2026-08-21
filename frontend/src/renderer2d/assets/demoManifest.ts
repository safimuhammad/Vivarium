import type { Direction4, Vec2 } from "../contracts";
import type { SpriteClip, SpriteFrame, SpriteLayerManifest, SpriteManifest } from "./spriteManifest";

const feet: Vec2 = { x: 24, y: 61 };
const frame = (column: number, row: number, durationMs = 160): SpriteFrame => ({
  rect: { x: column * 48, y: row * 64, width: 48, height: 64 }, durationMs, feet,
});
const clip = (id: string, direction: Direction4 | "none", frames: readonly SpriteFrame[], strideLength?: number): SpriteClip => ({
  id, direction, frames, loop: id.startsWith("idle") || id.startsWith("walk"), strideLength,
  markers: id.startsWith("walk") ? [{ frame: 1, name: "contact" }] : [], cancelFrames: frames.map((_item, index) => index),
});
const directionalClips = (direction: Direction4, row: number): Record<string, SpriteClip> => ({
  [`idle_${direction}`]: clip(`idle_${direction}`, direction, [
    frame(0, row, 240), frame(1, row, 260), frame(2, row, 240), frame(3, row, 260),
  ]),
  [`walk_${direction}`]: clip(`walk_${direction}`, direction, [4, 5, 6, 7, 8, 9].map((column) => frame(column, row)), 12),
  [`turn_${direction}`]: clip(`turn_${direction}`, direction, [frame(10, row, 60), frame(11, row, 60)]),
  [`stop_${direction}`]: clip(`stop_${direction}`, direction, [frame(12, row, 60), frame(13, row, 60)]),
});
const bodyClips: Record<string, SpriteClip> = {
  ...directionalClips("south", 0),
  ...directionalClips("west", 1),
  ...directionalClips("north", 2),
  ...directionalClips("east", 3),
  reach: clip("reach", "none", [frame(0, 4), frame(1, 4), frame(2, 4), frame(3, 4)]),
  fall: clip("fall", "none", [frame(0, 5), frame(1, 5), frame(2, 5), frame(3, 5)]),
  recover: clip("recover", "none", [frame(0, 6), frame(1, 6), frame(2, 6), frame(3, 6)]),
};
const overlayLayer = (id: "face" | "held", atlasId: "human-face" | "human-held", clips: Record<string, SpriteClip>): SpriteLayerManifest => ({
  id, atlasId, anchor: { x: 0, y: 0 }, tintable: false, clips,
});
const faceClips: Record<string, SpriteClip> = Object.fromEntries(
  (["south", "west", "north", "east"] as const).flatMap((direction, row) => (
    ["neutral", "blink_1", "blink_2", "talk_1", "talk_2", "weary", "hurt", "recovery"]
      .map((expression, column) => {
        const id = `${expression}_${direction}`;
        return [id, clip(id, direction, [frame(column, row, 180)])] as const;
      })
  )),
);
const heldClips: Record<string, SpriteClip> = {
  empty: clip("empty", "none", [frame(0, 0, 180)]),
  basket: clip("basket", "none", [frame(1, 0, 180)]),
  carry_wood: clip("carry_wood", "none", [frame(2, 0, 180)]),
  carry_stone: clip("carry_stone", "none", [frame(3, 0, 180)]),
  work: clip("work", "none", [frame(4, 0, 160), frame(5, 0, 160)]),
  reach: clip("reach", "none", [frame(6, 0, 180)]),
  reserve: clip("reserve", "none", [frame(7, 0, 180)]),
};

export const DEMO_HUMAN_MANIFEST: SpriteManifest = {
  id: "demo-human", logicalWidth: 48, logicalHeight: 64,
  faceAnchor: { x: 0, y: 0 }, heldAnchor: { x: 0, y: 0 },
  layers: [
    { id: "body", atlasId: "human-body", clips: bodyClips, anchor: { x: 0, y: 0 }, tintable: false },
    overlayLayer("face", "human-face", faceClips), overlayLayer("held", "human-held", heldClips),
  ],
};
