import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  PRODUCTION_ASSET_MANIFEST,
  PRODUCTION_DIRECTIONAL_FACE_ANCHORS,
  PRODUCTION_FACINGS,
  PRODUCTION_RIG_IDS,
  type ProductionAssetLease,
  type ProductionFacing,
  type ProductionRigId,
} from "../assets/productionManifest";
import { deriveHumanAppearance } from "./appearance";
import { LayeredHumanActor } from "./LayeredHumanActor";

const CANVAS_WIDTH = 96;
const CANVAS_HEIGHT = 96;
const STATES = ["idle", "walk", "turn", "talk", "work", "hurt", "recovery"] as const;
type ReviewState = (typeof STATES)[number];

interface DrawCall {
  readonly atlasId: string;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly destinationX: number;
  readonly destinationY: number;
  readonly destinationWidth: number;
  readonly destinationHeight: number;
}

interface RawAtlas {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
}

interface RuntimeCaseEvidence {
  readonly rig: ProductionRigId;
  readonly facing: ProductionFacing;
  readonly state: ReviewState;
  readonly bodyClipId: string;
  readonly bodyFrameIndex: number;
  readonly faceDestination: readonly [number, number];
  readonly hairDestination: readonly [number, number];
  readonly nativePixelsSha256: string;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function idForRig(rig: ProductionRigId): string {
  for (let index = 0; index < 100; index += 1) {
    const id = `runtime-compositor-${index}`;
    if (deriveHumanAppearance(id).rig === rig) return id;
  }
  throw new Error(`No deterministic actor ID found for ${rig}.`);
}

function leases(): ReadonlyMap<string, ProductionAssetLease<ImageBitmap>> {
  return new Map(Object.values(PRODUCTION_ASSET_MANIFEST.atlases)
    .filter(({ group }) => group === "core")
    .map(({ id }) => [
      id,
      {
        value: { atlasId: id } as unknown as ImageBitmap,
        release: () => undefined,
      },
    ]));
}

function recordingContext(calls: DrawCall[]): CanvasRenderingContext2D {
  return {
    imageSmoothingEnabled: true,
    filter: "none",
    globalCompositeOperation: "source-over",
    globalAlpha: 1,
    fillStyle: "#000000",
    save: () => undefined,
    restore: () => undefined,
    drawImage: (image: CanvasImageSource, ...values: number[]) => {
      const [sourceX, sourceY, sourceWidth, sourceHeight,
        destinationX, destinationY, destinationWidth, destinationHeight] = values;
      calls.push({
        atlasId: (image as unknown as { readonly atlasId: string }).atlasId,
        sourceX: sourceX!,
        sourceY: sourceY!,
        sourceWidth: sourceWidth!,
        sourceHeight: sourceHeight!,
        destinationX: destinationX!,
        destinationY: destinationY!,
        destinationWidth: destinationWidth!,
        destinationHeight: destinationHeight!,
      });
    },
    fillRect: () => undefined,
  } as unknown as CanvasRenderingContext2D;
}

function waypoint(facing: ProductionFacing): { readonly x: number; readonly y: number } {
  return {
    south: { x: 48, y: 96 },
    east: { x: 72, y: 72 },
    north: { x: 48, y: 48 },
    west: { x: 24, y: 72 },
  }[facing];
}

function nextFacing(facing: ProductionFacing): ProductionFacing {
  return PRODUCTION_FACINGS[(PRODUCTION_FACINGS.indexOf(facing) + 1) % PRODUCTION_FACINGS.length]!;
}

function actorFor(
  rig: ProductionRigId,
  facing: ProductionFacing,
  state: ReviewState,
): LayeredHumanActor {
  const actor = new LayeredHumanActor({
    id: idForRig(rig),
    name: `${rig} compositor fixture`,
    position: { x: 48, y: 72 },
    facing,
    manifest: PRODUCTION_ASSET_MANIFEST,
    atlasLeases: leases(),
  });
  switch (state) {
    case "idle":
      break;
    case "walk":
      actor.apply({
        kind: "move",
        waypoints: [waypoint(facing)],
        speedPixelsPerSecond: 24,
        gait: "walk",
      }, 0);
      actor.advance(0.2, 200);
      break;
    case "turn":
      actor.apply({ kind: "orient", facing: nextFacing(facing) }, 0);
      break;
    case "talk":
      actor.apply({ kind: "set-face", expression: "talk-2" }, 0);
      break;
    case "work":
      actor.apply({ kind: "play-body", action: "work" }, 0);
      actor.advance(0.361, 361);
      break;
    case "hurt":
      actor.apply({ kind: "play-body", action: "hurt-fall" }, 0);
      actor.advance(0.481, 481);
      break;
    case "recovery":
      actor.apply({ kind: "set-status", status: "paralyzed" }, 0);
      actor.apply({ kind: "recover" }, 1);
      actor.advance(0.121, 122);
      break;
  }
  return actor;
}

async function loadRawAtlases(): Promise<ReadonlyMap<string, RawAtlas>> {
  return new Map(await Promise.all(Object.values(PRODUCTION_ASSET_MANIFEST.atlases)
    .filter(({ group }) => group === "core")
    .map(async (atlas) => {
      const packedPath = resolve(
        process.cwd(),
        "src/assets/renderer2d/core",
        `${atlas.id.slice("core-".length)}.png`,
      );
      const packedBytes = await readFile(packedPath);
      expect(sha256(packedBytes), `${atlas.id} packed source identity`).toBe(atlas.sha256);
      const { data, info } = await sharp(packedBytes)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return [atlas.id, { width: info.width, height: info.height, data }] as const;
    })));
}

function compositePixel(destination: Buffer, offset: number, source: Buffer, sourceOffset: number): void {
  const sourceAlpha = source[sourceOffset + 3]! / 255;
  if (sourceAlpha <= 0) return;
  const destinationAlpha = destination[offset + 3]! / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  for (let channel = 0; channel < 3; channel += 1) {
    const sourceColor = source[sourceOffset + channel]!;
    const destinationColor = destination[offset + channel]!;
    destination[offset + channel] = Math.round(
      (sourceColor * sourceAlpha + destinationColor * destinationAlpha * (1 - sourceAlpha))
        / outputAlpha,
    );
  }
  destination[offset + 3] = Math.round(outputAlpha * 255);
}

function rasterize(calls: readonly DrawCall[], atlases: ReadonlyMap<string, RawAtlas>): Buffer {
  const output = Buffer.alloc(CANVAS_WIDTH * CANVAS_HEIGHT * 4);
  for (const call of calls) {
    expect(call.destinationWidth).toBe(call.sourceWidth);
    expect(call.destinationHeight).toBe(call.sourceHeight);
    const atlas = atlases.get(call.atlasId);
    if (!atlas) throw new Error(`Missing raw compositor atlas ${call.atlasId}.`);
    for (let y = 0; y < call.sourceHeight; y += 1) {
      for (let x = 0; x < call.sourceWidth; x += 1) {
        const destinationX = call.destinationX + x;
        const destinationY = call.destinationY + y;
        if (destinationX < 0 || destinationX >= CANVAS_WIDTH
          || destinationY < 0 || destinationY >= CANVAS_HEIGHT) continue;
        const sourceOffset = ((call.sourceY + y) * atlas.width + call.sourceX + x) * 4;
        const destinationOffset = (destinationY * CANVAS_WIDTH + destinationX) * 4;
        compositePixel(output, destinationOffset, atlas.data, sourceOffset);
      }
    }
  }
  return output;
}

function nearest2x(source: Buffer): Buffer {
  const width = CANVAS_WIDTH * 2;
  const output = Buffer.alloc(width * CANVAS_HEIGHT * 2 * 4);
  for (let y = 0; y < CANVAS_HEIGHT; y += 1) {
    for (let x = 0; x < CANVAS_WIDTH; x += 1) {
      const sourceOffset = (y * CANVAS_WIDTH + x) * 4;
      for (let offsetY = 0; offsetY < 2; offsetY += 1) {
        for (let offsetX = 0; offsetX < 2; offsetX += 1) {
          const destinationOffset = ((y * 2 + offsetY) * width + x * 2 + offsetX) * 4;
          source.copy(output, destinationOffset, sourceOffset, sourceOffset + 4);
        }
      }
    }
  }
  return output;
}

function directNativeCalls(
  actor: LayeredHumanActor,
  runtimeCalls: readonly DrawCall[],
): readonly DrawCall[] {
  const snapshot = actor.snapshot();
  const rig = snapshot.appearance.rig;
  const clip = Object.values(PRODUCTION_ASSET_MANIFEST.human.rigs[rig].bodyClips)
    .find(({ id }) => id === snapshot.layers.body.clipId);
  if (!clip) throw new Error(`Missing active native clip ${snapshot.layers.body.clipId}.`);
  const bodyFrame = clip.frames[snapshot.layers.body.frameIndex]!;
  const bodyCall = runtimeCalls.find(({ atlasId }) => (
    atlasId === PRODUCTION_ASSET_MANIFEST.human.layerAtlases.body
  ));
  if (!bodyCall) throw new Error("Runtime compositor omitted its required body draw.");
  const anchor = PRODUCTION_DIRECTIONAL_FACE_ANCHORS[snapshot.facing];
  const expectedX = bodyCall.destinationX + bodyFrame.faceAnchor.x - anchor.x;
  const expectedY = bodyCall.destinationY + bodyFrame.faceAnchor.y - anchor.y;
  return runtimeCalls.map((call) => (
    call.atlasId === PRODUCTION_ASSET_MANIFEST.human.layerAtlases.face
      || call.atlasId === PRODUCTION_ASSET_MANIFEST.human.layerAtlases.hair
      ? { ...call, destinationX: expectedX, destinationY: expectedY }
      : call
  ));
}

function paintEvidenceBackground(sheet: Buffer, width: number, height: number): void {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const checker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
      sheet[offset] = checker ? 151 : 164;
      sheet[offset + 1] = checker ? 168 : 181;
      sheet[offset + 2] = checker ? 116 : 128;
      sheet[offset + 3] = 255;
    }
  }
}

function blit(sheet: Buffer, sheetWidth: number, source: Buffer, left: number, top: number): void {
  for (let y = 0; y < CANVAS_HEIGHT; y += 1) {
    for (let x = 0; x < CANVAS_WIDTH; x += 1) {
      const sourceOffset = (y * CANVAS_WIDTH + x) * 4;
      const destinationOffset = ((top + y) * sheetWidth + left + x) * 4;
      compositePixel(sheet, destinationOffset, source, sourceOffset);
    }
  }
}

describe("LayeredHumanActor native compositor evidence", () => {
  it("matches direct native geometry and pixels at 1x and nearest-neighbor 2x", async () => {
    const atlases = await loadRawAtlases();
    const evidence: RuntimeCaseEvidence[] = [];
    const casePixels: Buffer[] = [];
    for (const rig of PRODUCTION_RIG_IDS) {
      for (const facing of PRODUCTION_FACINGS) {
        for (const state of STATES) {
          const actor = actorFor(rig, facing, state);
          const runtimeCalls: DrawCall[] = [];
          actor.draw(recordingContext(runtimeCalls));
          expect(runtimeCalls, `${rig}/${facing}/${state} required layer cardinality`).toHaveLength(4);
          const directCalls = directNativeCalls(actor, runtimeCalls);
          expect(runtimeCalls, `${rig}/${facing}/${state} direct native geometry`).toEqual(directCalls);
          const runtime1x = rasterize(runtimeCalls, atlases);
          const direct1x = rasterize(directCalls, atlases);
          expect(runtime1x.byteLength).toBe(direct1x.byteLength);
          expect(sha256(runtime1x), `${rig}/${facing}/${state} native pixels`)
            .toBe(sha256(direct1x));
          const runtime2x = nearest2x(runtime1x);
          const direct2x = nearest2x(direct1x);
          expect(runtime2x.byteLength).toBe(direct2x.byteLength);
          expect(sha256(runtime2x), `${rig}/${facing}/${state} 2x pixels`)
            .toBe(sha256(direct2x));
          const snapshot = actor.snapshot();
          const faceCall = runtimeCalls.find(({ atlasId }) => (
            atlasId === PRODUCTION_ASSET_MANIFEST.human.layerAtlases.face
          ))!;
          const hairCall = runtimeCalls.find(({ atlasId }) => (
            atlasId === PRODUCTION_ASSET_MANIFEST.human.layerAtlases.hair
          ))!;
          evidence.push({
            rig,
            facing,
            state,
            bodyClipId: snapshot.layers.body.clipId,
            bodyFrameIndex: snapshot.layers.body.frameIndex,
            faceDestination: [faceCall.destinationX, faceCall.destinationY],
            hairDestination: [hairCall.destinationX, hairCall.destinationY],
            nativePixelsSha256: sha256(runtime1x),
          });
          casePixels.push(runtime1x);
        }
      }
    }

    if (process.env.VIVARIUM_WRITE_HUMAN_COMPOSITOR_EVIDENCE === "1") {
      const columns = STATES.length;
      const rows = PRODUCTION_RIG_IDS.length * PRODUCTION_FACINGS.length;
      const width = columns * CANVAS_WIDTH;
      const height = rows * CANVAS_HEIGHT;
      const sheet = Buffer.alloc(width * height * 4);
      paintEvidenceBackground(sheet, width, height);
      casePixels.forEach((pixels, index) => {
        blit(
          sheet,
          width,
          pixels,
          index % columns * CANVAS_WIDTH,
          Math.floor(index / columns) * CANVAS_HEIGHT,
        );
      });
      const outputDirectory = resolve(
        process.cwd(),
        "../scratchpad/2d-production-art/evidence",
      );
      await mkdir(outputDirectory, { recursive: true });
      const sheet1x = await sharp(sheet, { raw: { width, height, channels: 4 } }).png().toBuffer();
      const sheet2x = await sharp(sheet, { raw: { width, height, channels: 4 } })
        .resize(width * 2, height * 2, { kernel: sharp.kernel.nearest })
        .png()
        .toBuffer();
      await writeFile(`${outputDirectory}/runtime-compositor-human-1x.png`, sheet1x);
      await writeFile(`${outputDirectory}/runtime-compositor-human-2x.png`, sheet2x);
      await writeFile(`${outputDirectory}/runtime-compositor-human.json`, `${JSON.stringify({
        contract: "LayeredHumanActor.draw vs direct native source-over; CSS palette filters excluded",
        ordering: "rig -> facing -> idle, walk, turn, talk, work, hurt, recovery",
        canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
        cases: evidence,
        contactSheet1xSha256: sha256(sheet1x),
        contactSheet2xSha256: sha256(sheet2x),
      }, null, 2)}\n`);
    }
  });
});
