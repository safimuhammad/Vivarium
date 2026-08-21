import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import sharp from "sharp";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "../..");
const SOURCE_RELATIVE_PATH =
  "scratchpad/2d-production-art/source/imagegen-concepts/worn-heartland-landmarks-approved.png";
const SOURCE_PATH = path.join(REPOSITORY_ROOT, SOURCE_RELATIVE_PATH);
const DEFAULT_OUTPUT_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "frontend/src/assets/renderer2d/regions/nirvana-v2",
);
const SOURCE_PROFILE = Object.freeze({
  width: 512,
  height: 256,
  sha256: "e66db44bc88e532189562826b100de7afc389703e7ee9528b47b3f768e444957",
});
const TILE_SIZE = 32;
const TERRAIN_COLUMNS = 8;
const TERRAIN_ROWS = 4;
const LANDMARK_WIDTH = 512;
const LANDMARK_HEIGHT = 384;
const FOREST_MAX_OPAQUE_DIMENSION = 108;
const TRANSPARENT = Object.freeze({ r: 0, g: 0, b: 0, alpha: 0 });
const GROUND = Object.freeze({ r: 95, g: 101, b: 60, alpha: 1 });
const TERRAIN_PALETTE = Object.freeze({
  olive: Object.freeze([
    Object.freeze([151, 164, 88, 255]),
    Object.freeze([158, 170, 94, 255]),
    Object.freeze([147, 160, 84, 255]),
    Object.freeze([162, 172, 98, 255]),
  ]),
  worn: Object.freeze([
    Object.freeze([174, 169, 102, 255]),
    Object.freeze([181, 174, 108, 255]),
  ]),
  garden: Object.freeze([
    Object.freeze([143, 154, 83, 255]),
    Object.freeze([150, 160, 88, 255]),
  ]),
  road: Object.freeze([220, 169, 104, 255]),
  roadLight: Object.freeze([235, 190, 124, 255]),
  shoulder: Object.freeze([185, 157, 94, 255]),
  swale: Object.freeze([137, 116, 75, 255]),
  swaleLight: Object.freeze([163, 139, 91, 255]),
  swaleBank: Object.freeze([154, 145, 88, 255]),
});
const PNG_OPTIONS = Object.freeze({
  palette: true,
  colours: 128,
  dither: 0,
  compressionLevel: 9,
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const encodeRaw = (data, width, height) =>
  sharp(data, { raw: { width, height, channels: 4 } }).png(PNG_OPTIONS).toBuffer();

const TERRAIN_TEXTURE_CROPS = Object.freeze({
  olive0: { left: 276, top: 138, width: 48, height: 48 },
  olive1: { left: 326, top: 204, width: 44, height: 44 },
  olive2: { left: 390, top: 136, width: 44, height: 44 },
  olive3: { left: 462, top: 198, width: 44, height: 44 },
  worn0: { left: 278, top: 202, width: 40, height: 40 },
  worn1: { left: 396, top: 190, width: 40, height: 40 },
  garden0: { left: 408, top: 40, width: 48, height: 48 },
  garden1: { left: 447, top: 42, width: 48, height: 48 },
  road: { left: 438, top: 158, width: 24, height: 24 },
  swale: { left: 58, top: 70, width: 32, height: 32 },
});

const ROAD_FRAMES = Object.freeze([
  { id: "terrain.road.isolated", connections: [] },
  { id: "terrain.road.end.n", connections: ["N"] },
  { id: "terrain.road.end.e", connections: ["E"] },
  { id: "terrain.road.end.s", connections: ["S"] },
  { id: "terrain.road.end.w", connections: ["W"] },
  { id: "terrain.road.straight.ns", connections: ["N", "S"] },
  { id: "terrain.road.straight.ew", connections: ["E", "W"] },
  { id: "terrain.road.corner.ne", connections: ["N", "E"] },
  { id: "terrain.road.corner.se", connections: ["E", "S"] },
  { id: "terrain.road.corner.sw", connections: ["S", "W"] },
  { id: "terrain.road.corner.nw", connections: ["W", "N"] },
  { id: "terrain.road.tee.n", connections: ["N", "E", "W"] },
  { id: "terrain.road.tee.e", connections: ["N", "E", "S"] },
  { id: "terrain.road.tee.s", connections: ["E", "S", "W"] },
  { id: "terrain.road.tee.w", connections: ["N", "S", "W"] },
  { id: "terrain.road.cross", connections: ["N", "E", "S", "W"] },
]);

const LANDMARK_SPECS = Object.freeze([
  {
    id: "landmark.hero-oak",
    sourceRect: { left: 0, top: 0, width: 128, height: 128 },
    rect: { x: 0, y: 0, width: 128, height: 128 },
    pivot: { x: 64, y: 124 },
  },
  {
    id: "landmark.forest-edge.cluster.0",
    sourceRect: { left: 128, top: 0, width: 128, height: 128 },
    rect: { x: 128, y: 0, width: 128, height: 128 },
    pivot: { x: 64, y: 124 },
    maximumOpaqueDimension: FOREST_MAX_OPAQUE_DIMENSION,
  },
  {
    id: "landmark.forest-edge.cluster.1",
    sourceRect: { left: 256, top: 0, width: 128, height: 128 },
    rect: { x: 256, y: 0, width: 128, height: 128 },
    pivot: { x: 64, y: 124 },
    maximumOpaqueDimension: FOREST_MAX_OPAQUE_DIMENSION,
  },
  {
    id: "landmark.garden.wall",
    sourceRect: { left: 400, top: 2, width: 72, height: 48 },
    rect: { x: 384, y: 0, width: 64, height: 64 },
    pivot: { x: 32, y: 60 },
    keyGround: true,
  },
  {
    id: "landmark.garden.corner",
    sourceRect: { left: 384, top: 16, width: 56, height: 64 },
    rect: { x: 448, y: 0, width: 64, height: 64 },
    pivot: { x: 32, y: 60 },
    keyGround: true,
  },
  {
    id: "landmark.garden.broken-wall",
    sourceRect: { left: 474, top: 38, width: 38, height: 66 },
    rect: { x: 384, y: 64, width: 64, height: 64 },
    pivot: { x: 32, y: 60 },
    keyGround: true,
  },
  {
    id: "landmark.garden.gate",
    sourceRect: { left: 424, top: 84, width: 64, height: 44 },
    rect: { x: 448, y: 64, width: 64, height: 64 },
    pivot: { x: 32, y: 60 },
    keyGround: true,
  },
  {
    id: "landmark.flower-colony",
    sourceRect: { left: 84, top: 94, width: 32, height: 32 },
    rect: { x: 0, y: 128, width: 48, height: 48 },
    pivot: { x: 24, y: 44 },
    keyGround: true,
  },
  {
    id: "landmark.shrub",
    sourceRect: { left: 330, top: 82, width: 36, height: 40 },
    rect: { x: 48, y: 128, width: 48, height: 48 },
    pivot: { x: 24, y: 44 },
    keyGround: true,
  },
  {
    id: "landmark.tall-grass",
    sourceRect: { left: 272, top: 81, width: 32, height: 40 },
    rect: { x: 96, y: 128, width: 48, height: 48 },
    pivot: { x: 24, y: 44 },
    keyGround: true,
  },
  {
    id: "landmark.rocks",
    sourceRect: { left: 393, top: 56, width: 36, height: 34 },
    rect: { x: 144, y: 128, width: 48, height: 48 },
    pivot: { x: 24, y: 44 },
    keyGround: true,
  },
  {
    id: "landmark.log",
    sourceRect: { left: 342, top: 169, width: 40, height: 44 },
    rect: { x: 192, y: 128, width: 48, height: 48 },
    pivot: { x: 24, y: 44 },
    keyGround: true,
  },
  {
    id: "landmark.stump",
    sourceRect: { left: 462, top: 143, width: 40, height: 52 },
    rect: { x: 240, y: 128, width: 48, height: 48 },
    pivot: { x: 24, y: 44 },
    keyGround: true,
  },
  {
    id: "landmark.ruined-garden",
    sourceRect: { left: 384, top: 0, width: 128, height: 128 },
    rect: { x: 320, y: 128, width: 128, height: 128 },
    pivot: { x: 64, y: 124 },
    keyGround: true,
  },
  {
    id: "landmark.meadow-edge.north",
    sourceRect: { left: 256, top: 128, width: 128, height: 64 },
    rect: { x: 0, y: 256, width: 128, height: 64 },
    pivot: { x: 64, y: 60 },
    keyGround: true,
  },
  {
    id: "landmark.meadow-edge.south",
    sourceRect: { left: 256, top: 192, width: 128, height: 64 },
    rect: { x: 128, y: 256, width: 128, height: 64 },
    pivot: { x: 64, y: 60 },
    keyGround: true,
  },
  {
    id: "landmark.meadow-edge.west",
    sourceRect: { left: 384, top: 128, width: 64, height: 128 },
    rect: { x: 256, y: 256, width: 64, height: 128 },
    pivot: { x: 32, y: 124 },
    keyGround: true,
  },
  {
    id: "landmark.meadow-edge.east",
    sourceRect: { left: 448, top: 128, width: 64, height: 128 },
    rect: { x: 320, y: 256, width: 64, height: 128 },
    pivot: { x: 32, y: 124 },
    keyGround: true,
  },
]);

async function assertApprovedSource(source) {
  const metadata = await sharp(source).metadata();
  if (metadata.width !== SOURCE_PROFILE.width || metadata.height !== SOURCE_PROFILE.height) {
    throw new Error(
      `Unexpected Nirvana source dimensions ${metadata.width}x${metadata.height}; ` +
        `expected ${SOURCE_PROFILE.width}x${SOURCE_PROFILE.height}`,
    );
  }
  const digest = sha256(source);
  if (digest !== SOURCE_PROFILE.sha256) {
    throw new Error(
      `Unexpected Nirvana source fingerprint ${digest}; expected ${SOURCE_PROFILE.sha256}`,
    );
  }
  return metadata;
}

async function sampleTexture(source, rect) {
  const { data } = await sharp(source)
    .extract(rect)
    .resize(TILE_SIZE, TILE_SIZE, { kernel: "nearest" })
    .flatten({ background: GROUND })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

function copyTexturePixel(output, outputPixel, texture, x, y, offsetX = 0, offsetY = 0) {
  const sourceX = (x + offsetX + TILE_SIZE) % TILE_SIZE;
  const sourceY = (y + offsetY + TILE_SIZE) % TILE_SIZE;
  texture.copy(
    output,
    outputPixel * 4,
    (sourceY * TILE_SIZE + sourceX) * 4,
    (sourceY * TILE_SIZE + sourceX) * 4 + 4,
  );
  output[outputPixel * 4 + 3] = 255;
}

function dilate(mask, radius) {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      for (let dy = -radius; dy <= radius && result[y * TILE_SIZE + x] === 0; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nearX = x + dx;
          const nearY = y + dy;
          if (
            nearX >= 0 &&
            nearY >= 0 &&
            nearX < TILE_SIZE &&
            nearY < TILE_SIZE &&
            mask[nearY * TILE_SIZE + nearX] !== 0
          ) {
            result[y * TILE_SIZE + x] = 1;
            break;
          }
        }
      }
    }
  }
  return result;
}

function routeMask(connections, variant, halfWidth = 7, centerRadius = 10) {
  const connected = new Set(connections);
  const mask = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const wave = (position) => [0, 0, 1, 0, -1, 0, 1, -1][Math.floor(position / 4) % 8];
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const centerX = 15.5 + wave(y + variant);
      const centerY = 15.5 + wave(x + variant * 2);
      const central = (x - 15.5) ** 2 + (y - 15.5) ** 2 <= centerRadius ** 2;
      const north = connected.has("N") && y <= 16 && Math.abs(x - centerX) <= halfWidth;
      const east = connected.has("E") && x >= 15 && Math.abs(y - centerY) <= halfWidth;
      const south = connected.has("S") && y >= 15 && Math.abs(x - centerX) <= halfWidth;
      const west = connected.has("W") && x <= 16 && Math.abs(y - centerY) <= halfWidth;
      if (central || north || east || south || west) mask[y * TILE_SIZE + x] = 1;
    }
  }
  return mask;
}

function writeColor(output, pixel, color) {
  output[pixel * 4] = color[0];
  output[pixel * 4 + 1] = color[1];
  output[pixel * 4 + 2] = color[2];
  output[pixel * 4 + 3] = color[3];
}

function shiftedColor(color, amount) {
  return Object.freeze([
    Math.max(0, Math.min(255, color[0] + amount)),
    Math.max(0, Math.min(255, color[1] + amount)),
    Math.max(0, Math.min(255, color[2] + amount)),
    color[3],
  ]);
}

function groundColor(kind, variant, x, y) {
  const family = TERRAIN_PALETTE[kind];
  const base = family[variant % family.length];
  if (x <= 1 || y <= 1 || x >= TILE_SIZE - 2 || y >= TILE_SIZE - 2) return base;
  const hash = (x * 37 + y * 53 + variant * 97 + x * y * 3) % 113;
  if (hash < 5) return shiftedColor(base, -12);
  if (hash > 108) return shiftedColor(base, 11);
  if ((Math.floor((x + variant * 3) / 9) + Math.floor((y + variant) / 7)) % 7 === 0) {
    return shiftedColor(base, -4);
  }
  return base;
}

async function cleanGroundCell(kind, variant) {
  const output = Buffer.alloc(TILE_SIZE * TILE_SIZE * 4);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      writeColor(output, y * TILE_SIZE + x, groundColor(kind, variant, x, y));
    }
  }
  return encodeRaw(output, TILE_SIZE, TILE_SIZE);
}

async function roadCell(connections, variant) {
  const route = routeMask(connections, variant);
  const shoulder = dilate(route, 2);
  const output = Buffer.alloc(TILE_SIZE * TILE_SIZE * 4);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const pixel = y * TILE_SIZE + x;
      if (route[pixel]) {
        const grain = (x * 11 + y * 17 + variant * 13) % 41;
        writeColor(
          output,
          pixel,
          grain < 2 ? TERRAIN_PALETTE.roadLight : TERRAIN_PALETTE.road,
        );
      } else if (shoulder[pixel]) {
        writeColor(output, pixel, TERRAIN_PALETTE.shoulder);
      } else {
        writeColor(output, pixel, groundColor("worn", variant, x, y));
      }
    }
  }
  return encodeRaw(output, TILE_SIZE, TILE_SIZE);
}

async function swaleCell(connections, variant) {
  const channel = routeMask(connections, variant + 3, 6, 8);
  const bank = dilate(channel, 2);
  const output = Buffer.alloc(TILE_SIZE * TILE_SIZE * 4);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const pixel = y * TILE_SIZE + x;
      if (channel[pixel]) {
        const grain = (x * 7 + y * 19 + variant * 5) % 37;
        writeColor(
          output,
          pixel,
          grain < 3 ? TERRAIN_PALETTE.swaleLight : TERRAIN_PALETTE.swale,
        );
      } else if (bank[pixel]) {
        writeColor(output, pixel, TERRAIN_PALETTE.swaleBank);
      } else {
        writeColor(output, pixel, groundColor("worn", variant, x, y));
      }
    }
  }
  return encodeRaw(output, TILE_SIZE, TILE_SIZE);
}

async function fordCell(roadConnections, swaleConnections, variant) {
  const channel = routeMask(swaleConnections, variant + 3, 6, 8);
  const bank = dilate(channel, 2);
  const road = routeMask(roadConnections, variant);
  const roadShoulder = dilate(road, 1);
  const output = Buffer.alloc(TILE_SIZE * TILE_SIZE * 4);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const pixel = y * TILE_SIZE + x;
      if (road[pixel]) {
        const plank = Math.floor((roadConnections.includes("N") ? y : x) / 4) % 2;
        writeColor(
          output,
          pixel,
          plank === 0 ? TERRAIN_PALETTE.road : TERRAIN_PALETTE.roadLight,
        );
      } else if (roadShoulder[pixel]) {
        writeColor(output, pixel, TERRAIN_PALETTE.shoulder);
      } else if (channel[pixel]) {
        writeColor(output, pixel, TERRAIN_PALETTE.swale);
      } else if (bank[pixel]) {
        writeColor(output, pixel, TERRAIN_PALETTE.swaleBank);
      } else {
        writeColor(output, pixel, groundColor("worn", variant, x, y));
      }
    }
  }
  return encodeRaw(output, TILE_SIZE, TILE_SIZE);
}

async function createTerrainAssets(_source) {
  const frameDefinitions = [
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `terrain.grass.olive.${index}`,
      kind: "ground",
      ground: "olive",
      variant: index,
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      id: `terrain.grass.worn.${index}`,
      kind: "ground",
      ground: "worn",
      variant: index,
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      id: `terrain.garden.floor.${index}`,
      kind: "ground",
      ground: "garden",
      variant: index,
    })),
    ...ROAD_FRAMES.map((frame) => ({ ...frame, kind: "road" })),
    { id: "terrain.swale.straight.ew", kind: "swale", connections: ["E", "W"] },
    { id: "terrain.swale.straight.ns", kind: "swale", connections: ["N", "S"] },
    { id: "terrain.swale.corner.ne", kind: "swale", connections: ["N", "E"] },
    { id: "terrain.swale.corner.se", kind: "swale", connections: ["E", "S"] },
    { id: "terrain.swale.corner.sw", kind: "swale", connections: ["S", "W"] },
    { id: "terrain.swale.corner.nw", kind: "swale", connections: ["W", "N"] },
    {
      id: "terrain.ford.ns",
      kind: "ford",
      connections: ["N", "S"],
      swaleConnections: ["E", "W"],
    },
    {
      id: "terrain.ford.ew",
      kind: "ford",
      connections: ["E", "W"],
      swaleConnections: ["N", "S"],
    },
  ];
  if (frameDefinitions.length !== TERRAIN_COLUMNS * TERRAIN_ROWS) {
    throw new Error(`Expected 32 terrain frames; received ${frameDefinitions.length}`);
  }

  const buffers = [];
  const frames = [];
  for (const [index, definition] of frameDefinitions.entries()) {
    let buffer;
    if (definition.kind === "ground") {
      buffer = await cleanGroundCell(definition.ground, definition.variant);
    } else if (definition.kind === "road") {
      buffer = await roadCell(definition.connections, index);
    } else if (definition.kind === "swale") {
      buffer = await swaleCell(definition.connections, index);
    } else {
      buffer = await fordCell(definition.connections, definition.swaleConnections, index);
    }
    const x = (index % TERRAIN_COLUMNS) * TILE_SIZE;
    const y = Math.floor(index / TERRAIN_COLUMNS) * TILE_SIZE;
    buffers.push({ input: buffer, left: x, top: y });
    frames.push({
      id: definition.id,
      image: "terrain",
      rect: { x, y, width: TILE_SIZE, height: TILE_SIZE },
      pivot: { x: 0, y: 0 },
      ...(definition.connections ? { connections: definition.connections } : {}),
    });
  }

  const atlas = await sharp({
    create: {
      width: TERRAIN_COLUMNS * TILE_SIZE,
      height: TERRAIN_ROWS * TILE_SIZE,
      channels: 4,
      background: GROUND,
    },
  })
    .composite(buffers)
    .png(PNG_OPTIONS)
    .toBuffer();
  return { atlas, frames };
}

const backgroundLike = (red, green, blue) => {
  const olive =
    red >= 38 &&
    red <= 170 &&
    green >= 42 &&
    green <= 170 &&
    blue >= 24 &&
    blue <= 105 &&
    green >= blue &&
    Math.abs(red - green) <= 45;
  const path = red >= 125 && green >= 75 && green <= 165 && blue <= 120 && red >= green;
  return olive || path;
};

async function keyConnectedGround(source) {
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const visited = new Uint8Array(info.width * info.height);
  const queue = new Int32Array(info.width * info.height);
  let head = 0;
  let tail = 0;
  const enqueue = (x, y) => {
    const pixel = y * info.width + x;
    if (visited[pixel]) return;
    const offset = pixel * 4;
    if (
      data[offset + 3] > 8 &&
      !backgroundLike(data[offset], data[offset + 1], data[offset + 2])
    ) {
      return;
    }
    visited[pixel] = 1;
    queue[tail] = pixel;
    tail += 1;
  };
  for (let x = 0; x < info.width; x += 1) {
    enqueue(x, 0);
    enqueue(x, info.height - 1);
  }
  for (let y = 1; y < info.height - 1; y += 1) {
    enqueue(0, y);
    enqueue(info.width - 1, y);
  }
  while (head < tail) {
    const pixel = queue[head];
    head += 1;
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    if (x > 0) enqueue(x - 1, y);
    if (x + 1 < info.width) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y + 1 < info.height) enqueue(x, y + 1);
  }
  for (let pixel = 0; pixel < visited.length; pixel += 1) {
    const offset = pixel * 4;
    if (visited[pixel] || data[offset + 3] <= 8) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
    }
  }
  return { data, info };
}

function alphaBounds(data, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0
    ? null
    : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function normalizeLandmark(source, spec) {
  const crop = await sharp(source).extract(spec.sourceRect).png().toBuffer();
  const keyed = spec.keyGround
    ? await keyConnectedGround(crop)
    : await sharp(crop).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bounds = alphaBounds(keyed.data, keyed.info.width, keyed.info.height);
  if (!bounds) throw new Error(`${spec.id}: source crop contains no reusable artwork`);
  const trimmed = await sharp(keyed.data, { raw: keyed.info }).extract(bounds).png().toBuffer();
  const innerWidth = Math.min(
    spec.rect.width - 8,
    spec.maximumOpaqueDimension ?? Number.POSITIVE_INFINITY,
  );
  const innerHeight = Math.min(
    spec.rect.height - 8,
    spec.maximumOpaqueDimension ?? Number.POSITIVE_INFINITY,
  );
  const scale = Math.min(innerWidth / bounds.width, innerHeight / bounds.height);
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const resized = await sharp(trimmed)
    .resize(width, height, { kernel: "nearest" })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: spec.rect.width,
      height: spec.rect.height,
      channels: 4,
      background: TRANSPARENT,
    },
  })
    .composite([
      {
        input: resized,
        left: Math.floor((spec.rect.width - width) / 2),
        top: spec.rect.height - 4 - height,
      },
    ])
    .png(PNG_OPTIONS)
    .toBuffer();
}

async function createLandmarkAssets(source) {
  const composites = [];
  const frames = [];
  for (const spec of LANDMARK_SPECS) {
    composites.push({
      input: await normalizeLandmark(source, spec),
      left: spec.rect.x,
      top: spec.rect.y,
    });
    frames.push({
      id: spec.id,
      image: "landmarks",
      rect: spec.rect,
      pivot: spec.pivot,
    });
  }
  const atlas = await sharp({
    create: {
      width: LANDMARK_WIDTH,
      height: LANDMARK_HEIGHT,
      channels: 4,
      background: TRANSPARENT,
    },
  })
    .composite(composites)
    .png(PNG_OPTIONS)
    .toBuffer();
  return { atlas, frames };
}

function generationFingerprint(files) {
  const digest = createHash("sha256");
  for (const { name, bytes } of [...files].sort((left, right) => left.name.localeCompare(right.name))) {
    digest.update(name);
    digest.update("\0");
    digest.update(String(bytes.byteLength));
    digest.update("\0");
    digest.update(bytes);
  }
  return digest.digest("hex");
}

async function pathMetadata(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

async function publishAtomically(files, outputDirectory) {
  const expectedNames = ["atlas.json", "landmarks.png", "terrain.png"];
  const names = files.map(({ name }) => name).sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error(`Nirvana publication requires exactly ${expectedNames.join(", ")}`);
  }

  const outputParent = path.dirname(outputDirectory);
  const outputName = path.basename(outputDirectory);
  const generationsDirectory = path.join(outputParent, `.${outputName}-generations`);
  await mkdir(outputParent, { recursive: true });

  const currentOutput = await pathMetadata(outputDirectory);
  if (currentOutput !== null && !currentOutput.isSymbolicLink()) {
    throw new Error(
      `Atomic Nirvana publication requires ${outputDirectory} to be absent or a symbolic link; `
      + "migrate the legacy directory before publishing.",
    );
  }

  await mkdir(generationsDirectory, { recursive: true });
  const stagedGeneration = await mkdtemp(path.join(generationsDirectory, ".staging-"));
  let stagedGenerationOwned = true;
  let stagedLinkDirectory = null;
  try {
    await Promise.all(files.map(({ name, bytes }) => (
      writeFile(path.join(stagedGeneration, name), bytes, { flag: "wx" })
    )));

    const generationDirectory = path.join(generationsDirectory, generationFingerprint(files));
    try {
      await rename(stagedGeneration, generationDirectory);
      stagedGenerationOwned = false;
    } catch (error) {
      if (!error || typeof error !== "object" || !["EEXIST", "ENOTEMPTY"].includes(error.code)) {
        throw error;
      }
      const existingGeneration = await pathMetadata(generationDirectory);
      if (existingGeneration === null || !existingGeneration.isDirectory()) throw error;
    }

    stagedLinkDirectory = await mkdtemp(path.join(outputParent, `.${outputName}-link-`));
    const stagedLink = path.join(stagedLinkDirectory, "current");
    await symlink(path.relative(outputParent, generationDirectory), stagedLink, "dir");
    await rename(stagedLink, outputDirectory);
    return generationDirectory;
  } finally {
    if (stagedGenerationOwned) {
      await rm(stagedGeneration, { recursive: true, force: true });
    }
    if (stagedLinkDirectory !== null) {
      await rm(stagedLinkDirectory, { recursive: true, force: true });
    }
  }
}

export async function buildNirvanaV2PilotAtlas({
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
} = {}) {
  const resolvedOutputDirectory = path.resolve(outputDirectory);
  const source = await readFile(SOURCE_PATH);
  const sourceMetadata = await assertApprovedSource(source);
  const [terrain, landmarks] = await Promise.all([
    createTerrainAssets(source),
    createLandmarkAssets(source),
  ]);
  const manifest = {
    schema: 1,
    tileSize: TILE_SIZE,
    source: {
      file: SOURCE_RELATIVE_PATH,
      width: sourceMetadata.width,
      height: sourceMetadata.height,
      sha256: sha256(source),
    },
    images: {
      terrain: {
        file: "terrain.png",
        width: TERRAIN_COLUMNS * TILE_SIZE,
        height: TERRAIN_ROWS * TILE_SIZE,
        compressedBytes: terrain.atlas.byteLength,
        decodedBytes: TERRAIN_COLUMNS * TILE_SIZE * TERRAIN_ROWS * TILE_SIZE * 4,
        sha256: sha256(terrain.atlas),
      },
      landmarks: {
        file: "landmarks.png",
        width: LANDMARK_WIDTH,
        height: LANDMARK_HEIGHT,
        compressedBytes: landmarks.atlas.byteLength,
        decodedBytes: LANDMARK_WIDTH * LANDMARK_HEIGHT * 4,
        sha256: sha256(landmarks.atlas),
      },
    },
    frames: [...terrain.frames, ...landmarks.frames],
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await publishAtomically([
    { name: "terrain.png", bytes: terrain.atlas },
    { name: "landmarks.png", bytes: landmarks.atlas },
    { name: "atlas.json", bytes: manifestBytes },
  ], resolvedOutputDirectory);
  return manifest;
}

function outputDirectoryFromArguments(arguments_) {
  if (arguments_.length === 0) return DEFAULT_OUTPUT_DIRECTORY;
  if (arguments_.length !== 2 || arguments_[0] !== "--output-dir" || !arguments_[1]) {
    throw new Error("Usage: build-nirvana-v2-pilot-atlas.mjs [--output-dir <directory>]");
  }
  return path.resolve(arguments_[1]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputDirectory = outputDirectoryFromArguments(process.argv.slice(2));
  const manifest = await buildNirvanaV2PilotAtlas({ outputDirectory });
  console.log(
    JSON.stringify({
      outputDirectory: path.relative(REPOSITORY_ROOT, outputDirectory),
      frames: manifest.frames.length,
      images: manifest.images,
    }),
  );
}
