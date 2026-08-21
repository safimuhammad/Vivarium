/**
 * Authors the isolated native-pixel character pilot atlases.
 *
 * The pilot owns its assets and metadata; production atlases are never read or
 * modified by this author.
 */

import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import sharp from "sharp";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_ROOT = path.resolve(
  MODULE_ROOT,
  "../src/qa/characterPilot/assets",
);
const CANONICAL_ANCHOR_SOURCE = path.resolve(
  MODULE_ROOT,
  "../src/assets/renderer2d/core/production-core-source.json",
);
const CANONICAL_ANCHOR_SOURCE_PATH = "src/assets/renderer2d/core/production-core-source.json";
const FRAME_WIDTH = 48;
const FRAME_HEIGHT = 64;
const BODY_COLUMNS = 16;
const FACINGS = Object.freeze(["south", "east", "north", "west"]);
const BODY_ACTIONS = Object.freeze([
  ["idle", 4],
  ["walk", 6],
  ["run", 8],
  ["turn", 2],
  ["stop", 2],
  ["reach-give", 6],
  ["work", 6],
  ["hurt-fall", 6],
  ["prone", 2],
  ["dead", 1],
]);
const EXPRESSIONS = Object.freeze([
  "neutral",
  "blink-1",
  "blink-2",
  "talk-1",
  "talk-2",
  "weary",
  "hurt",
  "recovery",
]);
const DIRECTIONAL_FACE_ANCHORS = Object.freeze({
  south: Object.freeze({ x: 24, y: 18 }),
  east: Object.freeze({ x: 26, y: 19 }),
  north: Object.freeze({ x: 24, y: 18 }),
  west: Object.freeze({ x: 22, y: 18 }),
});
const OVERLAY_HELD_ANCHOR = Object.freeze({ x: 34, y: 38 });
const PNG_OPTIONS = Object.freeze({
  compressionLevel: 9,
  adaptiveFiltering: false,
  palette: false,
});
const PALETTE = Object.freeze({
  outline: rgba("#281d18"),
  skinDark: rgba("#8f5639"),
  skin: rgba("#d9915f"),
  skinLight: rgba("#f1bc82"),
  blush: rgba("#c77452"),
  eye: rgba("#2a1a14"),
  hair: rgba("#543522"),
  hairMid: rgba("#70492e"),
  hairLight: rgba("#92623d"),
  creamDark: rgba("#b9a276"),
  cream: rgba("#e6d5ac"),
  creamLight: rgba("#f5eacb"),
  greenDark: rgba("#35442d"),
  green: rgba("#596b43"),
  greenLight: rgba("#748657"),
  leatherDark: rgba("#3f2a20"),
  leather: rgba("#65432c"),
  leatherLight: rgba("#8a5b36"),
  steelDark: rgba("#4c5960"),
  steel: rgba("#839399"),
  steelLight: rgba("#c3d0cb"),
  resourceDark: rgba("#365044"),
  resource: rgba("#65875a"),
  resourceLight: rgba("#a6bd72"),
  hurt: rgba("#b84e49"),
  statusGold: rgba("#f0c75c"),
  statusTeal: rgba("#65cbc1"),
  statusGrey: rgba("#a9afa6"),
  grass: rgba("#b8ca79"),
  grassDark: rgba("#8b9d5e"),
});

let publicationSequence = 0;

function rgba(hex) {
  const value = hex.replace("#", "");
  return Object.freeze([
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
    255,
  ]);
}

function createSurface(width, height) {
  return {
    width,
    height,
    data: Buffer.alloc(width * height * 4),
    clip: null,
  };
}

function pixel(surface, x, y, color) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (
    surface.clip
    && (
      px < surface.clip.left
      || py < surface.clip.top
      || px >= surface.clip.right
      || py >= surface.clip.bottom
    )
  ) {
    return;
  }
  if (px < 0 || py < 0 || px >= surface.width || py >= surface.height) return;
  const offset = (py * surface.width + px) * 4;
  surface.data[offset] = color[0];
  surface.data[offset + 1] = color[1];
  surface.data[offset + 2] = color[2];
  surface.data[offset + 3] = color[3];
}

function withClip(surface, left, top, width, height, draw) {
  const previous = surface.clip;
  surface.clip = {
    left,
    top,
    right: left + width,
    bottom: top + height,
  };
  try {
    draw();
  } finally {
    surface.clip = previous;
  }
}

function fillRect(surface, x, y, width, height, color) {
  for (let py = Math.round(y); py < Math.round(y + height); py += 1) {
    for (let px = Math.round(x); px < Math.round(x + width); px += 1) {
      pixel(surface, px, py, color);
    }
  }
}

function outlinedRect(surface, x, y, width, height, fill, outline = PALETTE.outline) {
  fillRect(surface, x, y, width, height, outline);
  if (width > 2 && height > 2) {
    fillRect(surface, x + 1, y + 1, width - 2, height - 2, fill);
  }
}

function ellipse(surface, centerX, centerY, radiusX, radiusY, color) {
  const rx = Math.max(1, Math.round(radiusX));
  const ry = Math.max(1, Math.round(radiusY));
  for (let y = -ry; y <= ry; y += 1) {
    for (let x = -rx; x <= rx; x += 1) {
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) {
        pixel(surface, centerX + x, centerY + y, color);
      }
    }
  }
}

function outlinedEllipse(
  surface,
  centerX,
  centerY,
  radiusX,
  radiusY,
  fill,
  outline = PALETTE.outline,
) {
  ellipse(surface, centerX, centerY, radiusX, radiusY, outline);
  if (radiusX > 1 && radiusY > 1) {
    ellipse(surface, centerX, centerY, radiusX - 1, radiusY - 1, fill);
  }
}

function line(surface, x0, y0, x1, y1, color, thickness = 1) {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const targetX = Math.round(x1);
  const targetY = Math.round(y1);
  const dx = Math.abs(targetX - x);
  const sx = x < targetX ? 1 : -1;
  const dy = -Math.abs(targetY - y);
  const sy = y < targetY ? 1 : -1;
  let error = dx + dy;
  while (true) {
    const half = Math.floor(thickness / 2);
    fillRect(surface, x - half, y - half, thickness, thickness, color);
    if (x === targetX && y === targetY) break;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
}

function polygon(surface, points, color) {
  const minY = Math.ceil(Math.min(...points.map(([, y]) => y)));
  const maxY = Math.floor(Math.max(...points.map(([, y]) => y)));
  for (let y = minY; y <= maxY; y += 1) {
    const intersections = [];
    for (let index = 0; index < points.length; index += 1) {
      const [x1, y1] = points[index];
      const [x2, y2] = points[(index + 1) % points.length];
      if (y1 === y2 || y < Math.min(y1, y2) || y >= Math.max(y1, y2)) continue;
      intersections.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const left = Math.ceil(intersections[index]);
      const right = Math.floor(intersections[index + 1]);
      fillRect(surface, left, y, right - left + 1, 1, color);
    }
  }
}

function outlinedPolygon(surface, points, fill, outline = PALETTE.outline) {
  polygon(surface, points, fill);
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    line(surface, x1, y1, x2, y2, outline);
  }
}

function bodyPhases() {
  return BODY_ACTIONS.flatMap(([action, count]) => (
    Array.from({ length: count }, (_unused, phase) => ({ action, count, phase }))
  ));
}

const BODY_PHASES = Object.freeze(bodyPhases());

function bodyCellIndex(facing, action, phase) {
  let actionOffset = 0;
  for (const [candidate, count] of BODY_ACTIONS) {
    if (candidate === action) {
      return FACINGS.indexOf(facing) * BODY_PHASES.length + actionOffset + phase;
    }
    actionOffset += count;
  }
  throw new Error(`Unknown body action ${action}.`);
}

async function loadCanonicalHumanAAnchors() {
  const bytes = await readFile(CANONICAL_ANCHOR_SOURCE);
  const source = JSON.parse(bytes.toString("utf8"));
  if (!Array.isArray(source.bodyFrameAnchors) || source.bodyFrameAnchors.length < 172) {
    throw new TypeError("Canonical body metadata requires at least 172 anchor tuples.");
  }
  const anchors = source.bodyFrameAnchors.slice(0, 172).map((candidate, index) => {
    if (
      !Array.isArray(candidate)
      || candidate.length !== 6
      || !candidate.every(Number.isInteger)
    ) {
      throw new TypeError(`Canonical human-a body anchor ${index} is invalid.`);
    }
    return Object.freeze([...candidate]);
  });
  return {
    anchors: Object.freeze(anchors),
    sourceHash: createHash("sha256").update(bytes).digest("hex"),
  };
}

function cellOrigin(index, columns, cellWidth, cellHeight) {
  return {
    x: (index % columns) * cellWidth,
    y: Math.floor(index / columns) * cellHeight,
  };
}

function travelPose(action, phase) {
  const walk = [-3, -2, 0, 3, 2, 0];
  const run = [-4, -3, -1, 2, 4, 3, 1, -2];
  const offset = action === "walk"
    ? walk[phase % walk.length]
    : action === "run"
      ? run[phase % run.length]
      : 0;
  return {
    legA: offset,
    legB: -offset,
    armA: -Math.sign(offset || (phase % 2 === 0 ? 1 : -1)),
    armB: Math.sign(offset || (phase % 2 === 0 ? 1 : -1)),
  };
}

function anchoredBodyGeometry(anchor, facing, action, phase) {
  const [feetX, feetY, faceX, faceY, heldX, heldY] = anchor;
  const axisX = feetX - faceX;
  const axisY = feetY - faceY;
  const axisLength = Math.max(1, Math.hypot(axisX, axisY));
  const unitX = axisX / axisLength;
  const unitY = axisY / axisLength;
  const perpendicularX = -unitY;
  const perpendicularY = unitX;
  const profile = facing === "east" || facing === "west";
  const shoulderDistance = Math.min(13, Math.max(9, axisLength * 0.32));
  const hipDistance = Math.max(
    shoulderDistance + 8,
    Math.min(axisLength - 8, axisLength * 0.66),
  );
  const shoulderCenter = {
    x: faceX + unitX * shoulderDistance,
    y: faceY + unitY * shoulderDistance,
  };
  const hipCenter = {
    x: faceX + unitX * hipDistance,
    y: faceY + unitY * hipDistance,
  };
  const shoulderHalfWidth = profile ? 5 : 8;
  const hipHalfWidth = profile ? 4 : 6;
  const shoulderA = {
    x: shoulderCenter.x + perpendicularX * shoulderHalfWidth,
    y: shoulderCenter.y + perpendicularY * shoulderHalfWidth,
  };
  const shoulderB = {
    x: shoulderCenter.x - perpendicularX * shoulderHalfWidth,
    y: shoulderCenter.y - perpendicularY * shoulderHalfWidth,
  };
  const hipA = {
    x: hipCenter.x + perpendicularX * hipHalfWidth,
    y: hipCenter.y + perpendicularY * hipHalfWidth,
  };
  const hipB = {
    x: hipCenter.x - perpendicularX * hipHalfWidth,
    y: hipCenter.y - perpendicularY * hipHalfWidth,
  };
  const distanceToHeld = (point) => Math.hypot(point.x - heldX, point.y - heldY);
  const activeShoulder = distanceToHeld(shoulderA) <= distanceToHeld(shoulderB)
    ? shoulderA
    : shoulderB;
  const passiveShoulder = activeShoulder === shoulderA ? shoulderB : shoulderA;
  const travel = travelPose(action, phase);
  const footSeparation = profile ? 5 : 7;
  const footA = {
    x: Math.max(
      1,
      Math.min(
        FRAME_WIDTH - 2,
        feetX + perpendicularX * footSeparation + unitX * travel.legA,
      ),
    ),
    y: Math.max(
      1,
      Math.min(
        FRAME_HEIGHT - 2,
        feetY + perpendicularY * footSeparation + unitY * travel.legA,
      ),
    ),
  };
  const footB = {
    x: Math.max(
      1,
      Math.min(
        FRAME_WIDTH - 2,
        feetX - perpendicularX * footSeparation + unitX * travel.legB,
      ),
    ),
    y: Math.max(
      1,
      Math.min(
        FRAME_HEIGHT - 2,
        feetY - perpendicularY * footSeparation + unitY * travel.legB,
      ),
    ),
  };
  const passiveHand = {
    x: Math.max(
      1,
      Math.min(FRAME_WIDTH - 2, passiveShoulder.x + unitX * 12 - perpendicularX * 2),
    ),
    y: Math.max(
      1,
      Math.min(FRAME_HEIGHT - 2, passiveShoulder.y + unitY * 12 - perpendicularY * 2),
    ),
  };
  return {
    feet: { x: feetX, y: feetY },
    face: { x: faceX, y: faceY },
    held: { x: heldX, y: heldY },
    unit: { x: unitX, y: unitY },
    perpendicular: { x: perpendicularX, y: perpendicularY },
    shoulderCenter,
    hipCenter,
    shoulderA,
    shoulderB,
    hipA,
    hipB,
    activeShoulder,
    passiveShoulder,
    footA,
    footB,
    passiveHand,
    profile,
  };
}

function drawAnchoredBody(surface, originX, originY, facing, action, phase, anchor) {
  const geometry = anchoredBodyGeometry(anchor, facing, action, phase);
  const point = ({ x, y }) => ({ x: originX + x, y: originY + y });
  const face = point(geometry.face);
  const held = point(geometry.held);
  const feetRoot = point(geometry.feet);
  const footA = point(geometry.footA);
  const footB = point(geometry.footB);
  const activeShoulder = point(geometry.activeShoulder);
  const passiveShoulder = point(geometry.passiveShoulder);
  const passiveHand = point(geometry.passiveHand);
  const direction = facing === "west" ? -1 : 1;

  const neckEnd = {
    x: face.x + geometry.unit.x * 13,
    y: face.y + geometry.unit.y * 13,
  };
  const neckStart = {
    x: face.x + geometry.unit.x * 7,
    y: face.y + geometry.unit.y * 7,
  };
  line(surface, neckStart.x, neckStart.y, neckEnd.x, neckEnd.y, PALETTE.outline, 5);
  line(surface, neckStart.x, neckStart.y, neckEnd.x, neckEnd.y, PALETTE.skin, 3);

  outlinedEllipse(
    surface,
    face.x,
    face.y,
    geometry.profile ? 7 : 8,
    10,
    PALETTE.skin,
  );
  fillRect(
    surface,
    face.x - 3,
    face.y - 7,
    geometry.profile ? 5 : 7,
    2,
    PALETTE.skinLight,
  );
  if (geometry.profile) {
    const noseX = face.x + direction * 7;
    outlinedRect(
      surface,
      noseX - (direction < 0 ? 2 : 0),
      face.y - 1,
      3,
      3,
      PALETTE.skin,
      PALETTE.skinDark,
    );
  } else {
    outlinedRect(surface, face.x - 10, face.y - 1, 3, 6, PALETTE.skin);
    outlinedRect(surface, face.x + 8, face.y - 1, 3, 6, PALETTE.skin);
  }

  line(
    surface,
    activeShoulder.x,
    activeShoulder.y,
    held.x,
    held.y,
    PALETTE.outline,
    5,
  );
  line(
    surface,
    activeShoulder.x,
    activeShoulder.y,
    held.x,
    held.y,
    PALETTE.skin,
    3,
  );
  line(
    surface,
    passiveShoulder.x,
    passiveShoulder.y,
    passiveHand.x,
    passiveHand.y,
    PALETTE.outline,
    5,
  );
  line(
    surface,
    passiveShoulder.x,
    passiveShoulder.y,
    passiveHand.x,
    passiveHand.y,
    PALETTE.skin,
    3,
  );
  outlinedEllipse(surface, held.x, held.y, 2, 3, PALETTE.skin);
  outlinedEllipse(surface, passiveHand.x, passiveHand.y, 2, 3, PALETTE.skin);
  pixel(surface, held.x, held.y, PALETTE.skinLight);

  const hipA = point(geometry.hipA);
  const hipB = point(geometry.hipB);
  line(surface, hipA.x, hipA.y, footA.x, footA.y - 1, PALETTE.outline, 5);
  line(surface, hipB.x, hipB.y, footB.x, footB.y - 1, PALETTE.outline, 5);
  outlinedEllipse(surface, footA.x, footA.y - 1, 4, 2, PALETTE.leather);
  outlinedEllipse(surface, footB.x, footB.y - 1, 4, 2, PALETTE.leather);
  pixel(surface, feetRoot.x, feetRoot.y, PALETTE.leatherLight);
  pixel(surface, face.x, face.y, PALETTE.skin);
}

function drawBodyCell(surface, cellIndex, facing, action, phase, _count, anchor) {
  const { x, y } = cellOrigin(cellIndex, BODY_COLUMNS, FRAME_WIDTH, FRAME_HEIGHT);
  withClip(surface, x, y, FRAME_WIDTH, FRAME_HEIGHT, () => {
    drawAnchoredBody(surface, x, y, facing, action, phase, anchor);
  });
}

function drawAnchoredClothing(surface, originX, originY, facing, action, phase, anchor) {
  const geometry = anchoredBodyGeometry(anchor, facing, action, phase);
  const point = ({ x, y }) => ({ x: originX + x, y: originY + y });
  const shoulderA = point(geometry.shoulderA);
  const shoulderB = point(geometry.shoulderB);
  const hipA = point(geometry.hipA);
  const hipB = point(geometry.hipB);
  const held = point(geometry.held);
  const passiveHand = point(geometry.passiveHand);
  const feetRoot = point(geometry.feet);
  const footA = point(geometry.footA);
  const footB = point(geometry.footB);
  const activeShoulder = point(geometry.activeShoulder);
  const passiveShoulder = point(geometry.passiveShoulder);

  outlinedPolygon(
    surface,
    [
      [shoulderA.x, shoulderA.y],
      [shoulderB.x, shoulderB.y],
      [hipB.x, hipB.y],
      [hipA.x, hipA.y],
    ],
    PALETTE.cream,
  );
  const torsoHighlightStart = {
    x: shoulderA.x * 0.75 + hipA.x * 0.25,
    y: shoulderA.y * 0.75 + hipA.y * 0.25,
  };
  const torsoHighlightEnd = {
    x: shoulderB.x * 0.75 + hipB.x * 0.25,
    y: shoulderB.y * 0.75 + hipB.y * 0.25,
  };
  line(
    surface,
    torsoHighlightStart.x,
    torsoHighlightStart.y,
    torsoHighlightEnd.x,
    torsoHighlightEnd.y,
    PALETTE.creamLight,
    2,
  );

  const activeSleeveEnd = {
    x: activeShoulder.x + (held.x - activeShoulder.x) * 0.58,
    y: activeShoulder.y + (held.y - activeShoulder.y) * 0.58,
  };
  const passiveSleeveEnd = {
    x: passiveShoulder.x + (passiveHand.x - passiveShoulder.x) * 0.58,
    y: passiveShoulder.y + (passiveHand.y - passiveShoulder.y) * 0.58,
  };
  line(
    surface,
    activeShoulder.x,
    activeShoulder.y,
    activeSleeveEnd.x,
    activeSleeveEnd.y,
    PALETTE.outline,
    7,
  );
  line(
    surface,
    activeShoulder.x,
    activeShoulder.y,
    activeSleeveEnd.x,
    activeSleeveEnd.y,
    PALETTE.cream,
    5,
  );
  line(
    surface,
    passiveShoulder.x,
    passiveShoulder.y,
    passiveSleeveEnd.x,
    passiveSleeveEnd.y,
    PALETTE.outline,
    7,
  );
  line(
    surface,
    passiveShoulder.x,
    passiveShoulder.y,
    passiveSleeveEnd.x,
    passiveSleeveEnd.y,
    PALETTE.cream,
    5,
  );

  line(surface, hipA.x, hipA.y, footA.x, footA.y - 1, PALETTE.outline, 7);
  line(surface, hipB.x, hipB.y, footB.x, footB.y - 1, PALETTE.outline, 7);
  line(surface, hipA.x, hipA.y, footA.x, footA.y - 1, PALETTE.green, 5);
  line(surface, hipB.x, hipB.y, footB.x, footB.y - 1, PALETTE.green, 5);
  line(surface, hipA.x, hipA.y, hipB.x, hipB.y, PALETTE.leatherDark, 3);
  const hipCenter = point(geometry.hipCenter);
  line(
    surface,
    hipCenter.x,
    hipCenter.y + geometry.unit.y * 2,
    (footA.x + footB.x) / 2,
    (footA.y + footB.y) / 2,
    PALETTE.greenDark,
    2,
  );
  outlinedEllipse(surface, footA.x, footA.y - 1, 4, 2, PALETTE.leather);
  outlinedEllipse(surface, footB.x, footB.y - 1, 4, 2, PALETTE.leather);

  line(surface, shoulderA.x, shoulderA.y, hipB.x, hipB.y, PALETTE.leatherDark, 4);
  line(surface, shoulderA.x, shoulderA.y, hipB.x, hipB.y, PALETTE.leather, 2);
  const bagCenter = {
    x: hipB.x - geometry.perpendicular.x * 3,
    y: hipB.y - geometry.perpendicular.y * 3,
  };
  outlinedRect(surface, bagCenter.x - 3, bagCenter.y - 3, 6, 8, PALETTE.leather);
  pixel(surface, bagCenter.x, bagCenter.y - 1, PALETTE.leatherLight);
  pixel(surface, feetRoot.x, feetRoot.y, PALETTE.leatherLight);
}

function drawClothingCell(surface, cellIndex, facing, action, phase, _count, anchor) {
  const { x, y } = cellOrigin(cellIndex, BODY_COLUMNS, FRAME_WIDTH, FRAME_HEIGHT);
  withClip(surface, x, y, FRAME_WIDTH, FRAME_HEIGHT, () => {
    drawAnchoredClothing(surface, x, y, facing, action, phase, anchor);
  });
}

function drawSouthFace(surface, originX, originY, expression) {
  const anchor = DIRECTIONAL_FACE_ANCHORS.south;
  const blink = expression === "blink-1" || expression === "blink-2";
  const weary = expression === "weary";
  const hurt = expression === "hurt";
  const eyeY = originY + anchor.y + (
    expression === "blink-2" ? 1 : expression === "blink-1" ? 0 : weary ? 0 : -1
  );
  const eyeHeight = expression === "blink-2" ? 1 : expression === "blink-1" ? 2 : hurt ? 2 : 3;
  const eyeWidth = blink ? 3 : 3;
  fillRect(surface, originX + anchor.x - 5, eyeY, eyeWidth, eyeHeight, PALETTE.eye);
  fillRect(surface, originX + anchor.x + 3, eyeY, eyeWidth, eyeHeight, PALETTE.eye);
  if (!blink && !hurt) {
    pixel(surface, originX + anchor.x - 5, eyeY, PALETTE.creamLight);
    pixel(surface, originX + anchor.x + 3, eyeY, PALETTE.creamLight);
  }
  line(surface, originX + anchor.x - 5, originY + anchor.y - 3, originX + anchor.x - 2, originY + anchor.y - 3, PALETTE.eye);
  line(surface, originX + anchor.x + 3, originY + anchor.y - 3, originX + anchor.x + 6, originY + anchor.y - 3, PALETTE.eye);
  pixel(surface, originX + anchor.x, originY + anchor.y + 3, PALETTE.skinDark);
  if (expression === "talk-1") {
    pixel(surface, originX + anchor.x, originY + anchor.y + 5, PALETTE.outline);
    pixel(surface, originX + anchor.x - 1, originY + anchor.y + 6, PALETTE.outline);
    pixel(surface, originX + anchor.x + 1, originY + anchor.y + 6, PALETTE.outline);
    pixel(surface, originX + anchor.x, originY + anchor.y + 7, PALETTE.outline);
    pixel(surface, originX + anchor.x, originY + anchor.y + 6, PALETTE.blush);
  } else if (expression === "talk-2") {
    fillRect(surface, originX + anchor.x - 1, originY + anchor.y + 5, 3, 1, PALETTE.outline);
    pixel(surface, originX + anchor.x - 2, originY + anchor.y + 6, PALETTE.outline);
    pixel(surface, originX + anchor.x + 2, originY + anchor.y + 6, PALETTE.outline);
    fillRect(surface, originX + anchor.x - 1, originY + anchor.y + 7, 3, 1, PALETTE.outline);
    fillRect(surface, originX + anchor.x - 1, originY + anchor.y + 6, 3, 1, PALETTE.blush);
  } else if (hurt) {
    line(surface, originX + anchor.x - 2, originY + anchor.y + 8, originX + anchor.x + 2, originY + anchor.y + 6, PALETTE.eye);
  } else if (weary) {
    line(surface, originX + anchor.x - 2, originY + anchor.y + 7, originX + anchor.x + 2, originY + anchor.y + 7, PALETTE.eye);
  } else {
    fillRect(surface, originX + anchor.x - 1, originY + anchor.y + 6, 3, 1, PALETTE.eye);
  }
  pixel(surface, originX + anchor.x - 7, originY + anchor.y + 5, PALETTE.blush);
  pixel(surface, originX + anchor.x + 7, originY + anchor.y + 5, PALETTE.blush);
}

function drawProfileFace(surface, originX, originY, facing, expression) {
  const direction = facing === "west" ? -1 : 1;
  const anchor = DIRECTIONAL_FACE_ANCHORS[facing];
  const centerX = originX + anchor.x;
  const centerY = originY + anchor.y;
  const blink = expression === "blink-1" || expression === "blink-2";
  const eyeX = centerX + (direction > 0 ? 2 : -4);
  const eyeY = centerY + (
    expression === "blink-2" ? 1 : expression === "blink-1" ? 0 : -2
  );
  fillRect(
    surface,
    eyeX,
    eyeY,
    3,
    expression === "blink-2" ? 1 : expression === "blink-1" ? 2 : 3,
    PALETTE.eye,
  );
  if (!blink) {
    pixel(
      surface,
      eyeX + (direction > 0 ? 0 : 2),
      eyeY,
      PALETTE.creamLight,
    );
  }
  line(
    surface,
    centerX + direction * 2,
    centerY - 4,
    centerX + direction * 5,
    centerY - 4,
    PALETTE.eye,
  );
  outlinedRect(
    surface,
    centerX + direction * 7 - (direction < 0 ? 2 : 0),
    centerY + 1,
    3,
    3,
    PALETTE.skin,
    PALETTE.skinDark,
  );
  if (expression.startsWith("talk")) {
    line(
      surface,
      centerX + direction * 3,
      centerY + 5,
      centerX + direction * (expression === "talk-2" ? 7 : 5),
      centerY + 6,
      PALETTE.eye,
      2,
    );
  } else {
    line(
      surface,
      centerX + direction * 3,
      centerY + 6,
      centerX + direction * 6,
      centerY + (expression === "hurt" ? 5 : 6),
      PALETTE.eye,
      2,
    );
  }
}

function drawFaceCell(surface, facing, expression) {
  const cellIndex = FACINGS.indexOf(facing) * 16 + EXPRESSIONS.indexOf(expression);
  const { x, y } = cellOrigin(cellIndex, 16, FRAME_WIDTH, FRAME_HEIGHT);
  if (facing === "north") return;
  withClip(surface, x, y, FRAME_WIDTH, FRAME_HEIGHT, () => {
    if (facing === "south") {
      drawSouthFace(surface, x, y, expression);
      return;
    }
    drawProfileFace(surface, x, y, facing, expression);
  });
}

function drawHairCluster(surface, centerX, centerY, radiusX, radiusY, fill) {
  outlinedEllipse(surface, centerX, centerY, radiusX, radiusY, fill, PALETTE.outline);
  pixel(surface, centerX - Math.max(1, radiusX - 2), centerY - 1, PALETTE.hairLight);
}

function drawHairCell(surface, facing, phase) {
  const cellIndex = 24 + FACINGS.indexOf(facing) * 6 + phase;
  const { x, y } = cellOrigin(cellIndex, 16, FRAME_WIDTH, FRAME_HEIGHT);
  const previousClip = surface.clip;
  surface.clip = { left: x, top: y, right: x + FRAME_WIDTH, bottom: y + FRAME_HEIGHT };
  const anchor = DIRECTIONAL_FACE_ANCHORS[facing];
  const centerX = x + anchor.x;
  const hairY = y + anchor.y - DIRECTIONAL_FACE_ANCHORS.south.y;
  const flutter = phase % 2;

  if (facing === "east" || facing === "west") {
    const direction = facing === "west" ? -1 : 1;
    drawHairCluster(
      surface,
      centerX - direction * 7,
      hairY + 10 + flutter,
      5,
      5,
      PALETTE.hair,
    );
    drawHairCluster(surface, centerX, hairY + 8, 6, 5, PALETTE.hairMid);
    drawHairCluster(
      surface,
      centerX + direction * 6,
      hairY + 10,
      4,
      4,
      PALETTE.hair,
    );
    drawHairCluster(
      surface,
      centerX - direction * 11,
      hairY + 16,
      3,
      6,
      PALETTE.hair,
    );
    drawHairCluster(
      surface,
      centerX - direction * 10,
      hairY + 23,
      3,
      5,
      PALETTE.hairMid,
    );
    outlinedPolygon(
      surface,
      [
        [centerX - direction * 2, hairY + 11],
        [centerX + direction * 7, hairY + 11],
        [centerX + direction * 6, hairY + 14],
        [centerX + direction, hairY + 15],
      ],
      PALETTE.hairMid,
    );
  } else {
    drawHairCluster(surface, centerX - 7, hairY + 10 + flutter, 5, 5, PALETTE.hair);
    drawHairCluster(surface, centerX, hairY + 8, 6, 5, PALETTE.hairMid);
    drawHairCluster(surface, centerX + 7, hairY + 10 + (1 - flutter), 5, 5, PALETTE.hair);
    drawHairCluster(surface, centerX - 11, hairY + 15, 3, 5, PALETTE.hair);
    drawHairCluster(surface, centerX + 11, hairY + 15, 3, 5, PALETTE.hairMid);
  }

  if (facing === "north") {
    outlinedRect(surface, centerX - 10, hairY + 13, 20, 12, PALETTE.hair);
    drawHairCluster(surface, centerX - 7, hairY + 22, 4, 5, PALETTE.hairMid);
    drawHairCluster(surface, centerX + 7, hairY + 22, 4, 5, PALETTE.hair);
  } else if (facing === "south") {
    outlinedPolygon(
      surface,
      [
        [centerX - 9, hairY + 12],
        [centerX - 3, hairY + 11],
        [centerX - 5, hairY + 15],
        [centerX - 10, hairY + 16],
      ],
      PALETTE.hairMid,
    );
    outlinedPolygon(
      surface,
      [
        [centerX - 3, hairY + 11],
        [centerX + 4, hairY + 10],
        [centerX + 1, hairY + 15],
        [centerX - 4, hairY + 16],
      ],
      PALETTE.hair,
    );
    outlinedPolygon(
      surface,
      [
        [centerX + 4, hairY + 10],
        [centerX + 10, hairY + 13],
        [centerX + 7, hairY + 16],
        [centerX + 1, hairY + 15],
      ],
      PALETTE.hairMid,
    );
    drawHairCluster(surface, centerX - 11, hairY + 23, 3, 5, PALETTE.hair);
    drawHairCluster(surface, centerX + 11, hairY + 22, 3, 5, PALETTE.hairMid);
  }

  pixel(surface, centerX - 3 + phase, hairY + 4 + (phase % 2), PALETTE.hairLight);
  pixel(surface, centerX + 5 - (phase % 3), hairY + 7, PALETTE.hairLight);
  surface.clip = previousClip;
}

function drawHammer(surface, originX, originY, facing) {
  const direction = facing === "west" ? -1 : 1;
  const gripX = originX + OVERLAY_HELD_ANCHOR.x;
  const gripY = originY + OVERLAY_HELD_ANCHOR.y;
  const headX = gripX + direction * 6;
  const headY = gripY - 13;
  line(
    surface,
    gripX,
    gripY,
    headX,
    headY,
    PALETTE.leatherDark,
    3,
  );
  line(
    surface,
    gripX,
    gripY,
    headX,
    headY,
    PALETTE.leatherLight,
  );
  outlinedRect(
    surface,
    headX - 5,
    headY - 3,
    11,
    6,
    PALETTE.steel,
  );
  fillRect(surface, headX - 3, headY - 2, 5, 2, PALETTE.steelLight);
  pixel(surface, gripX, gripY, PALETTE.leatherLight);
}

function drawResource(surface, originX, originY, facing) {
  const direction = facing === "west" ? -1 : 1;
  const gripX = originX + OVERLAY_HELD_ANCHOR.x;
  const gripY = originY + OVERLAY_HELD_ANCHOR.y;
  const centerX = gripX + (facing === "east" || facing === "west" ? direction : 0);
  const centerY = gripY + 4;
  outlinedEllipse(surface, centerX, centerY + 2, 6, 4, PALETTE.leather);
  line(surface, centerX - 5, centerY, gripX, gripY, PALETTE.leatherDark, 2);
  line(surface, gripX, gripY, centerX + 5, centerY, PALETTE.leatherDark, 2);
  drawHairCluster(surface, centerX - 3, centerY - 3, 2, 2, PALETTE.resource);
  drawHairCluster(surface, centerX + 1, centerY - 5, 2, 3, PALETTE.resourceLight);
  drawHairCluster(surface, centerX + 4, centerY - 2, 2, 2, PALETTE.resource);
  pixel(surface, gripX, gripY, PALETTE.leatherLight);
}

function drawHeldCells(surface) {
  for (const facing of FACINGS) {
    const facingOffset = FACINGS.indexOf(facing) * 16;
    const hammerOrigin = cellOrigin(facingOffset + 7, 16, FRAME_WIDTH, FRAME_HEIGHT);
    const resourceOrigin = cellOrigin(facingOffset + 14, 16, FRAME_WIDTH, FRAME_HEIGHT);
    withClip(surface, hammerOrigin.x, hammerOrigin.y, FRAME_WIDTH, FRAME_HEIGHT, () => {
      drawHammer(surface, hammerOrigin.x, hammerOrigin.y, facing);
    });
    withClip(surface, resourceOrigin.x, resourceOrigin.y, FRAME_WIDTH, FRAME_HEIGHT, () => {
      drawResource(surface, resourceOrigin.x, resourceOrigin.y, facing);
    });
  }
}

function drawStatusCells(surface) {
  const first = cellOrigin(0, 16, 32, 32);
  for (const [x, y] of [[7, 7], [16, 4], [25, 7], [28, 16], [25, 25], [16, 28], [7, 25], [4, 16]]) {
    outlinedRect(surface, first.x + x - 1, first.y + y - 1, 3, 3, PALETTE.statusGold);
  }
  const second = cellOrigin(1, 16, 32, 32);
  for (let offset = 0; offset < 4; offset += 1) {
    line(
      surface,
      second.x + 8 + offset * 5,
      second.y + 7,
      second.x + 6 + offset * 5,
      second.y + 24,
      PALETTE.statusTeal,
      2,
    );
  }
  const third = cellOrigin(2, 16, 32, 32);
  outlinedEllipse(surface, third.x + 16, third.y + 18, 9, 5, PALETTE.statusGrey);
  line(surface, third.x + 10, third.y + 13, third.x + 22, third.y + 23, PALETTE.outline, 2);
}

function buildPilotSurfaces(bodyFrameAnchors) {
  const body = createSurface(768, 704);
  const clothing = createSurface(768, 704);
  for (const facing of FACINGS) {
    for (const { action, count, phase } of BODY_PHASES) {
      const index = bodyCellIndex(facing, action, phase);
      const anchor = bodyFrameAnchors[index];
      drawBodyCell(body, index, facing, action, phase, count, anchor);
      drawClothingCell(clothing, index, facing, action, phase, count, anchor);
    }
  }

  const face = createSurface(768, 256);
  for (const facing of FACINGS) {
    for (const expression of EXPRESSIONS) drawFaceCell(face, facing, expression);
  }

  const hair = createSurface(768, 768);
  for (const facing of FACINGS) {
    for (let phase = 0; phase < 6; phase += 1) drawHairCell(hair, facing, phase);
  }

  const held = createSurface(768, 256);
  drawHeldCells(held);
  const status = createSurface(512, 256);
  drawStatusCells(status);
  return {
    body,
    clothing,
    face,
    hair,
    held,
    status,
    bodyFrameAnchors,
  };
}

function blendCell(
  target,
  source,
  cellIndex,
  columns,
  cellWidth = FRAME_WIDTH,
  cellHeight = FRAME_HEIGHT,
  destinationX = 0,
  destinationY = 0,
) {
  const { x: sourceX, y: sourceY } = cellOrigin(
    cellIndex,
    columns,
    cellWidth,
    cellHeight,
  );
  for (let y = 0; y < cellHeight; y += 1) {
    for (let x = 0; x < cellWidth; x += 1) {
      const targetX = x + destinationX;
      const targetY = y + destinationY;
      if (
        targetX < 0
        || targetY < 0
        || targetX >= target.width
        || targetY >= target.height
      ) {
        continue;
      }
      const sourceOffset = ((sourceY + y) * source.width + sourceX + x) * 4;
      const alpha = source.data[sourceOffset + 3];
      if (alpha === 0) continue;
      const targetOffset = (targetY * target.width + targetX) * 4;
      if (alpha === 255) {
        source.data.copy(target.data, targetOffset, sourceOffset, sourceOffset + 4);
        continue;
      }
      const sourceAlpha = alpha / 255;
      const targetAlpha = target.data[targetOffset + 3] / 255;
      const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
      for (let channel = 0; channel < 3; channel += 1) {
        target.data[targetOffset + channel] = Math.round(
          (
            source.data[sourceOffset + channel] * sourceAlpha
            + target.data[targetOffset + channel] * targetAlpha * (1 - sourceAlpha)
          ) / outputAlpha,
        );
      }
      target.data[targetOffset + 3] = Math.round(outputAlpha * 255);
    }
  }
}

function evidenceFrame(surfaces, facing, action, actionPhase, hairPhase) {
  const frame = createSurface(FRAME_WIDTH, FRAME_HEIGHT);
  fillRect(frame, 0, 0, FRAME_WIDTH, FRAME_HEIGHT, PALETTE.grass);
  for (const [x, y] of [[5, 8], [41, 6], [8, 27], [38, 31], [4, 51], [43, 48]]) {
    pixel(frame, x, y, PALETTE.grassDark);
  }
  ellipse(frame, 24, 60, 12, 3, PALETTE.grassDark);
  const bodyCell = bodyCellIndex(facing, action, actionPhase);
  const [, , bodyFaceX, bodyFaceY] = surfaces.bodyFrameAnchors[bodyCell];
  const overlayFace = DIRECTIONAL_FACE_ANCHORS[facing];
  const faceCell = FACINGS.indexOf(facing) * 16;
  const hairCell = 24 + FACINGS.indexOf(facing) * 6 + hairPhase;
  blendCell(frame, surfaces.body, bodyCell, 16);
  blendCell(frame, surfaces.clothing, bodyCell, 16);
  blendCell(
    frame,
    surfaces.face,
    faceCell,
    16,
    FRAME_WIDTH,
    FRAME_HEIGHT,
    bodyFaceX - overlayFace.x,
    bodyFaceY - overlayFace.y,
  );
  blendCell(
    frame,
    surfaces.hair,
    hairCell,
    16,
    FRAME_WIDTH,
    FRAME_HEIGHT,
    bodyFaceX - overlayFace.x,
    bodyFaceY - overlayFace.y,
  );
  return frame;
}

async function encodeSurface(surface) {
  return sharp(surface.data, {
    raw: {
      width: surface.width,
      height: surface.height,
      channels: 4,
    },
  })
    .png(PNG_OPTIONS)
    .toBuffer();
}

async function encodeEvidence(surface) {
  const native = await encodeSurface(surface);
  return sharp(native)
    .resize(FRAME_WIDTH * 8, FRAME_HEIGHT * 8, {
      kernel: "nearest",
      fit: "fill",
    })
    .png(PNG_OPTIONS)
    .toBuffer();
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function atomicPublish(outputRoot, file, bytes) {
  publicationSequence += 1;
  const temporary = path.join(
    outputRoot,
    `.${file}.tmp-${process.pid}-${publicationSequence}`,
  );
  const destination = path.join(outputRoot, file);
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return destination;
}

/**
 * Generate the pilot-only character atlases and publish metadata last.
 *
 * @param {string} [outputRoot] Destination directory.
 * @returns {Promise<string>} Absolute path to the published metadata file.
 */
export async function authorCharacterPilotArt(outputRoot = DEFAULT_OUTPUT_ROOT) {
  await mkdir(outputRoot, { recursive: true });
  const canonical = await loadCanonicalHumanAAnchors();
  const surfaces = buildPilotSurfaces(canonical.anchors);
  const atlasSources = [
    {
      id: "core-human-body-rigs",
      file: "character-pilot-body.png",
      surface: surfaces.body,
      cellWidth: 48,
      cellHeight: 64,
    },
    {
      id: "core-human-face-planes",
      file: "character-pilot-face.png",
      surface: surfaces.face,
      cellWidth: 48,
      cellHeight: 64,
    },
    {
      id: "core-human-hair",
      file: "character-pilot-hair.png",
      surface: surfaces.hair,
      cellWidth: 48,
      cellHeight: 64,
    },
    {
      id: "core-human-clothing-00",
      file: "character-pilot-clothing.png",
      surface: surfaces.clothing,
      cellWidth: 48,
      cellHeight: 64,
    },
    {
      id: "core-human-held",
      file: "character-pilot-held.png",
      surface: surfaces.held,
      cellWidth: 48,
      cellHeight: 64,
    },
    {
      id: "core-human-status-effects",
      file: "character-pilot-status.png",
      surface: surfaces.status,
      cellWidth: 32,
      cellHeight: 32,
    },
  ];
  const encodedAtlases = await Promise.all(
    atlasSources.map(async (source) => ({
      ...source,
      bytes: await encodeSurface(source.surface),
    })),
  );

  for (const atlas of encodedAtlases) {
    await atomicPublish(outputRoot, atlas.file, atlas.bytes);
  }

  const frontEvidence = await encodeEvidence(
    evidenceFrame(surfaces, "south", "idle", 0, 0),
  );
  const eastEvidence = await encodeEvidence(
    evidenceFrame(surfaces, "east", "walk", 3, 2),
  );
  await atomicPublish(
    outputRoot,
    "character-pilot-front-idle-evidence.png",
    frontEvidence,
  );
  await atomicPublish(
    outputRoot,
    "character-pilot-east-mid-walk-evidence.png",
    eastEvidence,
  );

  const metadata = {
    version: 1,
    frame: { width: FRAME_WIDTH, height: FRAME_HEIGHT },
    feet: { x: 24, y: 61 },
    walkStride: 12,
    selection: {
      rig: "human-a",
      hairSilhouette: "messy",
      clothingSilhouette: "work-shirt-sash",
      resourceHeldForm: "resource-handful",
      workHeldForm: "hammer",
    },
    topology: {
      actions: Object.fromEntries(BODY_ACTIONS),
      facings: [...FACINGS],
      expressions: [...EXPRESSIONS],
    },
    bodyFrameAnchors: canonical.anchors.map((tuple) => [...tuple]),
    anchorSource: {
      path: CANONICAL_ANCHOR_SOURCE_PATH,
      sha256: canonical.sourceHash,
    },
    atlases: encodedAtlases.map((atlas) => ({
      id: atlas.id,
      file: atlas.file,
      width: atlas.surface.width,
      height: atlas.surface.height,
      cellWidth: atlas.cellWidth,
      cellHeight: atlas.cellHeight,
      compressedBytes: atlas.bytes.length,
      decodedBytes: atlas.surface.width * atlas.surface.height * 4,
      sha256: hash(atlas.bytes),
    })),
  };
  const metadataBytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return atomicPublish(
    outputRoot,
    "character-pilot-assets.json",
    metadataBytes,
  );
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  authorCharacterPilotArt()
    .then((metadataPath) => {
      process.stdout.write(`${metadataPath}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    });
}
