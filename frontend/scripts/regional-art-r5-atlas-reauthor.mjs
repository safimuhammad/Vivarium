/** Deterministic native-pixel replacements for the approved R5 A-prime art pass. */

const OUTLINE = Object.freeze([28, 28, 36, 255]);
const PORTS = Object.freeze([
  Object.freeze(["w", "e"]), Object.freeze(["n", "s"]), Object.freeze(["n", "e"]),
  Object.freeze(["e", "s"]), Object.freeze(["s", "w"]), Object.freeze(["w", "n"]),
  Object.freeze(["n", "e", "s", "w"]), Object.freeze([]),
]);
const DIRECTIONS = Object.freeze({
  n: Object.freeze([16, 0]),
  e: Object.freeze([31, 16]),
  s: Object.freeze([16, 31]),
  w: Object.freeze([0, 16]),
});

const rgb = (hex) => Object.freeze([
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
  255,
]);

const STYLES = Object.freeze({
  "ash-waste": Object.freeze({
    base: rgb("#444454"), shade: rgb("#2b2a30"), mid: rgb("#645c6c"), light: rgb("#7c7484"),
    path: rgb("#c5a253"), water: rgb("#a6c45e"), soil: rgb("#504843"), accent: rgb("#e46c5c"),
  }),
  "dry-scrub": Object.freeze({
    base: rgb("#d7aa6d"), shade: rgb("#8d613e"), mid: rgb("#c18b55"), light: rgb("#f0cd91"),
    path: rgb("#f0cd91"), water: rgb("#8d613e"), soil: rgb("#d58a4c"), accent: rgb("#70503b"),
  }),
  "neutral-temperate": Object.freeze({
    base: rgb("#9bb18a"), shade: rgb("#486955"), mid: rgb("#88a58d"), light: rgb("#d8c9a6"),
    path: rgb("#d8c9a6"), water: rgb("#73aaa2"), soil: rgb("#6a5742"), accent: rgb("#b2886b"),
  }),
  "spring-terraces": Object.freeze({
    base: rgb("#a6bb7a"), shade: rgb("#32664d"), mid: rgb("#568048"), light: rgb("#c6b58b"),
    path: rgb("#c6b58b"), water: rgb("#5bb5bc"), soil: rgb("#684833"), accent: rgb("#2b7c97"),
  }),
  "worn-heartland": Object.freeze({
    base: rgb("#8f9854"), shade: rgb("#5d633d"), mid: rgb("#aa8652"), light: rgb("#c2c781"),
    path: rgb("#aa8652"), water: rgb("#5d633d"), soil: rgb("#6f5035"), accent: rgb("#c88d7a"),
  }),
});

const TARGETS = Object.freeze({
  "ash-waste": Object.freeze({ terrain: Object.freeze(range(0, 35)),
    scenery: Object.freeze([0, 1, 2, 3, 4, 5, 7, 8, 18, 22, 65, 69, 81, 85, 96, 100]),
    landmarks: Object.freeze(range(0, 7)) }),
  "dry-scrub": Object.freeze({ terrain: Object.freeze(range(0, 35)),
    scenery: Object.freeze([0, 2, 4, 5, 6, 8, 9, 11, 16, 20, 65, 69, 82, 86, 98, 102]),
    landmarks: Object.freeze(range(0, 7)) }),
  "neutral-temperate": Object.freeze({ terrain: Object.freeze(range(0, 35)),
    scenery: Object.freeze([0, 3, 4, 6, 9, 10, 11, 16, 20, 65, 69, 82, 86, 98, 102]),
    landmarks: Object.freeze(range(0, 7)) }),
  "spring-terraces": Object.freeze({ terrain: Object.freeze(range(0, 35)),
    scenery: Object.freeze([0, 1, 3, 4, 7, 8, 16, 20, 64, 68, 69, 73]),
    landmarks: Object.freeze(range(0, 7)) }),
  "worn-heartland": Object.freeze({ terrain: Object.freeze(range(0, 35)),
    scenery: Object.freeze([1, 2, 3, 4, 5, 6, 8, 12, 19, 23, 83, 85, 87, 89]),
    landmarks: Object.freeze(range(0, 7)) }),
});

const SCENERY_KINDS = Object.freeze({
  "ash-waste": Object.freeze({ tree: [4, 8, 96, 100], rock: [1, 5, 65, 69, 81, 85],
    grass: [2, 18, 22], fence: [3, 7], neutral: [0] }),
  "dry-scrub": Object.freeze({ tree: [5, 9, 65, 69], rock: [0, 4, 8, 16, 20],
    grass: [2, 6, 82, 86, 98, 102], fence: [11] }),
  "neutral-temperate": Object.freeze({ tree: [0, 4, 16, 20], rock: [9, 65, 69],
    grass: [3, 6, 10, 11, 82, 86, 98, 102], fence: [] }),
  "spring-terraces": Object.freeze({ tree: [1, 69], rock: [0, 4, 8, 16, 20, 64, 68],
    grass: [3, 7], fence: [], neutral: [73] }),
  "worn-heartland": Object.freeze({ tree: [4, 8], rock: [1, 5, 85, 89],
    grass: [2, 6], fence: [3, 19, 23, 83, 87], neutral: [12] }),
});

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function createRaw(width, height, fill = null) {
  const raw = { data: Buffer.alloc(width * height * 4), width, height, channels: 4 };
  if (fill) for (let offset = 0; offset < raw.data.length; offset += 4) {
    raw.data.set(fill, offset);
  }
  return raw;
}

function setPixel(raw, x, y, color) {
  if (x < 0 || y < 0 || x >= raw.width || y >= raw.height) return;
  raw.data.set(color, (y * raw.width + x) * 4);
}

function clearPixel(raw, x, y) {
  if (x < 0 || y < 0 || x >= raw.width || y >= raw.height) return;
  raw.data.fill(0, (y * raw.width + x) * 4, (y * raw.width + x + 1) * 4);
}

function rect(raw, x, y, width, height, color) {
  for (let py = y; py < y + height; py += 1) for (let px = x; px < x + width; px += 1) {
    setPixel(raw, px, py, color);
  }
}

function disc(raw, centerX, centerY, radius, color) {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) setPixel(raw, x, y, color);
    }
  }
}

function line(raw, x0, y0, x1, y1, thickness, color) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  const before = Math.max(0, Math.floor((thickness - 1) / 2));
  const after = Math.max(0, Math.ceil((thickness - 1) / 2));
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x0 + ((x1 - x0) * step) / steps);
    const y = Math.round(y0 + ((y1 - y0) * step) / steps);
    for (let py = y - before; py <= y + after; py += 1) {
      for (let px = x - before; px <= x + after; px += 1) setPixel(raw, px, py, color);
    }
  }
}

function raggedBand(raw, top, bottom, left, right, outline, fill, seed = 0) {
  for (let y = top; y <= bottom; y += 1) {
    const insetLeft = (seed + y * 3) % 5;
    const insetRight = (seed * 2 + y * 5) % 6;
    rect(raw, left + insetLeft, y, Math.max(1, right - left - insetLeft - insetRight), 1, outline);
  }
  for (let y = top + 3; y <= bottom - 3; y += 1) {
    const insetLeft = 4 + ((seed + y * 2) % 4);
    const insetRight = 4 + ((seed * 3 + y) % 5);
    rect(raw, left + insetLeft, y, Math.max(1, right - left - insetLeft - insetRight), 1, fill);
  }
}

function clumpLine(raw, x0, y0, x1, y1, outer, inner, stepSize = 9) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / stepSize));
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x0 + ((x1 - x0) * step) / steps);
    const y = Math.round(y0 + ((y1 - y0) * step) / steps);
    const radius = 6 + (step % 3);
    disc(raw, x, y, radius, outer);
    disc(raw, x + (step % 2 ? 2 : -1), y - 2, Math.max(3, radius - 3), inner);
    if (step % 2 === 0) disc(raw, x + 5, y + 2, 3, inner);
  }
}

function alphaOver(destination, source) {
  for (let offset = 0; offset < destination.data.length; offset += 4) {
    if (source.data[offset + 3] === 0) continue;
    source.data.copy(destination.data, offset, offset, offset + 4);
  }
}

function alphaOverWithoutSharedBase(destination, source, sharedMask) {
  for (let offset = 0; offset < destination.data.length; offset += 4) {
    const pixelIndex = offset / 4;
    const y = Math.floor(pixelIndex / source.width);
    if (source.data[offset + 3] === 0 || (y >= 80 && sharedMask?.[pixelIndex] === 1)) continue;
    source.data.copy(destination.data, offset, offset, offset + 4);
  }
}

function sharedOpaqueLandmarkMask(atlas) {
  const cells = range(0, 7).map((index) => extractCell(atlas, index, 128, 128));
  const mask = new Uint8Array(128 * 128);
  for (let pixelIndex = 0; pixelIndex < mask.length; pixelIndex += 1) {
    mask[pixelIndex] = cells.every((cell) => cell.data[pixelIndex * 4 + 3] === 255) ? 1 : 0;
  }
  return mask;
}

function extractCell(atlas, index, width, height) {
  const columns = atlas.width / width;
  const left = (index % columns) * width;
  const top = Math.floor(index / columns) * height;
  const output = createRaw(width, height);
  for (let y = 0; y < height; y += 1) {
    atlas.data.copy(output.data, y * width * 4, ((top + y) * atlas.width + left) * 4,
      ((top + y) * atlas.width + left + width) * 4);
  }
  return output;
}

function replaceCell(atlas, index, cell) {
  const columns = atlas.width / cell.width;
  const left = (index % columns) * cell.width;
  const top = Math.floor(index / columns) * cell.height;
  for (let y = 0; y < cell.height; y += 1) {
    cell.data.copy(atlas.data, ((top + y) * atlas.width + left) * 4, y * cell.width * 4,
      (y + 1) * cell.width * 4);
  }
}

function drawConnections(raw, ports, outer, inner, outerWidth, innerWidth) {
  if (ports.length === 0) {
    disc(raw, 16, 16, Math.max(2, Math.floor(innerWidth / 2)), inner);
    return;
  }
  for (const direction of ports) {
    const [x, y] = DIRECTIONS[direction];
    line(raw, 16, 16, x, y, outerWidth, outer);
  }
  for (const direction of ports) {
    const [x, y] = DIRECTIONS[direction];
    line(raw, 16, 16, x, y, innerWidth, inner);
  }
}

function paintTerrainCell(kit, index) {
  const style = STYLES[kit];
  const output = createRaw(32, 32, style.base);
  if (index < 8) {
    if (index === 1) setPixel(output, 11, 9, style.mid);
    if (index === 2) {
      setPixel(output, 7, 22, style.shade); setPixel(output, 24, 11, style.mid);
    }
    if (index === 3) line(output, 14, 23, 17, 22, 1, style.mid);
    if (index >= 4 && kit === "ash-waste") {
      line(output, 5 + index, 7, 14, 16 + (index % 3), 2, style.shade);
      line(output, 14, 16 + (index % 3), 25, 12 + (index % 4), 2, style.mid);
      if (index % 2 === 0) line(output, 14, 16, 18, 25, 1, style.accent);
    } else if (index >= 4 && kit === "dry-scrub") {
      line(output, 4, 10 + (index % 3) * 3, 27, 8 + (index % 3) * 3, 2, style.mid);
      line(output, 7, 19 + (index % 2) * 3, 24, 17 + (index % 2) * 3, 2, style.shade);
      line(output, 12, 25, 26, 24 - (index % 3), 1, style.light);
    } else if (index >= 4 && kit === "spring-terraces") {
      disc(output, 9 + (index % 3) * 4, 18, 4 + (index % 2), style.mid);
      line(output, 8, 21, 25, 12 + (index % 4), 2, style.water);
      line(output, 12, 23, 22, 19, 1, style.accent);
    } else if (index >= 4 && kit === "neutral-temperate") {
      disc(output, 9 + (index % 3) * 5, 18 - (index % 2) * 4, 4, style.mid);
      disc(output, 22, 22, 3 + (index % 2), style.shade);
      for (const [x, y] of [[7, 24], [15, 8], [25, 15]]) setPixel(output, x, y, style.accent);
    } else if (index >= 4) {
      line(output, 4, 21 - (index % 2) * 4, 27, 19 - (index % 2) * 4, 3, style.mid);
      line(output, 8, 9 + (index % 3) * 4, 22, 13 + (index % 3) * 3, 2, style.shade);
      for (const x of [7, 18, 26]) line(output, x, 23, x + 2, 27, 1, style.light);
    }
    return output;
  }
  if (index < 16) {
    const ports = PORTS[index - 8];
    if (ports.length === 0) {
      disc(output, 12, 20, 5, style.shade); disc(output, 12, 20, 3, style.path);
    } else {
      drawConnections(output, ports, style.shade, style.path, 11, 7);
      disc(output, 15 + (index % 3) - 1, 16 + (index % 2), 5 + (index % 2), style.path);
      line(output, 9 + (index % 4), 12 + (index % 3), 16, 10 + (index % 2), 1, style.light);
      line(output, 18, 21 + (index % 2), 24 + (index % 3), 23, 2, style.shade);
    }
    return output;
  }
  if (index < 24) {
    const ports = PORTS[index - 16];
    if (ports.length === 0) {
      disc(output, 19, 12, 6, style.shade); disc(output, 19, 12, 4, style.water);
    } else {
      drawConnections(output, ports, style.shade, style.water, 15, 11);
      if (kit === "spring-terraces" || kit === "neutral-temperate") {
        const rippleY = 11 + ((index - 16) % 4) * 3;
        line(output, 8 + (index % 3), rippleY, 15 + (index % 5), rippleY, 1,
          kit === "spring-terraces" ? style.accent : style.light);
        line(output, 18, 22 - (index % 4), 25, 21 - (index % 4), 1, style.mid);
      } else {
        line(output, 9 + (index % 4), 20, 21, 10 + (index % 3), 2, style.mid);
      }
    }
    return output;
  }
  if (index < 32) {
    const ports = PORTS[index - 24];
    if (ports.length === 0) {
      disc(output, 11, 12, 7, style.mid); disc(output, 11, 12, 3, style.water);
    } else {
      drawConnections(output, ports, style.shade, style.mid, 17, 13);
      drawConnections(output, ports, style.mid, style.water, 9, 5);
      disc(output, 16 + (index % 3) - 1, 16, 4, style.water);
      if (kit === "spring-terraces" || kit === "neutral-temperate") {
        line(output, 9, 8 + (index % 5), 16, 7 + (index % 5), 2, style.light);
      }
    }
    return output;
  }
  if (index === 32) {
    disc(output, 10, 19, 5, style.soil); disc(output, 19, 16, 4, style.soil);
    line(output, 8, 21, 23, 14, 1, style.shade);
  } else if (index === 33) {
    line(output, 5, 11, 25, 9, 3, style.soil);
    line(output, 9, 19, 28, 22, 2, style.shade);
  } else if (index === 34) {
    disc(output, 11, 11, 4, style.soil); disc(output, 21, 20, 6, style.soil);
    line(output, 9, 13, 23, 18, 2, style.mid);
  } else {
    line(output, 5, 24, 15, 8, 4, style.soil);
    line(output, 14, 9, 27, 15, 3, style.shade);
    disc(output, 23, 23, 3, style.soil);
  }
  return output;
}

function sceneryPorts(index) {
  const ports = [];
  if ([16, 18, 19, 64, 65, 81, 82, 83, 96, 98].includes(index)) ports.push("w");
  if ([20, 22, 23, 68, 69, 85, 86, 87, 100, 102].includes(index)) ports.push("e");
  if ([73, 89].includes(index)) ports.push("n");
  return ports;
}

function sceneryKind(kit, index) {
  for (const [kind, cells] of Object.entries(SCENERY_KINDS[kit])) if (cells.includes(index)) return kind;
  return "grass";
}

function sceneryFootprint(raw, style, index) {
  const variant = index % 5;
  if (variant === 0) {
    line(raw, 4, 27, 24, 24, 5, style.shade); line(raw, 8, 26, 22, 24, 2, style.mid);
  } else if (variant === 1) {
    disc(raw, 11, 26, 5, style.shade); line(raw, 13, 27, 28, 23, 4, style.mid);
  } else if (variant === 2) {
    line(raw, 3, 24, 16, 28, 4, style.mid); disc(raw, 23, 25, 4, style.shade);
  } else if (variant === 3) {
    line(raw, 8, 29, 26, 19, 5, style.shade); line(raw, 12, 28, 24, 21, 2, style.mid);
  } else {
    disc(raw, 9, 25, 4, style.mid); disc(raw, 20, 27, 5, style.shade);
  }
}

function paintSceneryCell(kit, index) {
  const style = STYLES[kit];
  const output = createRaw(32, 32);
  const ports = sceneryPorts(index);
  for (const direction of ports) {
    const [x, y] = DIRECTIONS[direction];
    line(output, 16, 25, x, y, 7, style.shade);
    line(output, 16, 25, x, y, 5, style.mid);
  }
  const kind = sceneryKind(kit, index);
  if (kind === "neutral") {
    line(output, 6, 27, 25, 25 + (index % 2), 2, style.shade);
    line(output, 11, 27, 21, 26, 1, style.mid);
    if (kit === "ash-waste") rect(output, 17, 23, 3, 2, style.mid);
    else if (kit === "spring-terraces") setPixel(output, 23, 24, style.water);
    else setPixel(output, 9, 24, style.light);
    return output;
  }
  sceneryFootprint(output, style, index);
  if (kind === "tree") {
    line(output, 16, 25, 16 + (index % 3) - 1, 8, 5, OUTLINE);
    line(output, 16, 24, 16 + (index % 3) - 1, 9, 3, kit === "ash-waste" ? style.mid : style.soil);
    line(output, 16, 13, 9, 8, 3, OUTLINE);
    line(output, 17, 14, 24, 10, 3, OUTLINE);
    if (kit === "neutral-temperate" || kit === "spring-terraces" || kit === "worn-heartland") {
      disc(output, 10, 8, 5, OUTLINE); disc(output, 22, 9, 6, OUTLINE);
      disc(output, 10, 8, 3, style.mid); disc(output, 22, 9, 4, style.light);
    }
  } else if (kind === "rock") {
    disc(output, 11, 20, 6, OUTLINE); disc(output, 21, 18, 7, OUTLINE);
    disc(output, 11, 20, 4, style.mid); disc(output, 21, 18, 5, style.light);
    line(output, 18, 15, 23, 13, 1, style.shade);
  } else if (kind === "fence") {
    line(output, 5, 21, 27, 18, 4, OUTLINE); line(output, 5, 21, 27, 18, 2, style.soil);
    line(output, 9, 25, 9, 12, 4, OUTLINE); line(output, 9, 25, 9, 12, 2, style.soil);
    line(output, 24, 22, 24, 11, 4, OUTLINE); line(output, 24, 22, 24, 11, 2, style.soil);
  } else {
    for (let blade = 0; blade < 5; blade += 1) {
      const x = 8 + blade * 4;
      line(output, x, 24, x + (blade % 2 === 0 ? -2 : 2), 10 + (blade % 3) * 2, 3, OUTLINE);
      line(output, x, 24, x + (blade % 2 === 0 ? -2 : 2), 10 + (blade % 3) * 2, 1,
        kit === "spring-terraces" ? style.mid : style.accent);
    }
  }
  if (kit === "ash-waste") rect(output, 23, 23, 2, 2, style.water);
  return output;
}

function organicFootprint(raw, style, variant, kit) {
  if (variant === 0) {
    line(raw, 7, 108, 77, 101, 11, style.shade); line(raw, 14, 106, 68, 101, 5, style.mid);
  } else if (variant === 1) {
    line(raw, 45, 105, 120, 112, 13, style.shade); line(raw, 55, 105, 112, 110, 5, style.mid);
  } else if (variant === 2) {
    line(raw, 15, 116, 91, 83, 12, style.shade); line(raw, 25, 111, 83, 86, 5, style.mid);
  } else if (variant === 3) {
    disc(raw, 27, 99, 13, style.shade); line(raw, 37, 101, 94, 111, 10, style.mid);
  } else if (variant === 4) {
    disc(raw, 101, 99, 15, style.shade); line(raw, 24, 112, 88, 103, 8, style.mid);
  } else if (variant === 5) {
    line(raw, 9, 112, 111, 72, 11, style.shade); line(raw, 20, 107, 101, 76, 4, style.mid);
  } else if (variant === 6) {
    line(raw, 6, 86, 103, 103, 12, style.shade); disc(raw, 105, 102, 9, style.mid);
  } else {
    line(raw, 28, 115, 118, 82, 10, style.shade); disc(raw, 22, 115, 8, style.mid);
  }
  if (kit === "dry-scrub") {
    line(raw, 18 + variant * 2, 103 - (variant % 3) * 7, 92 + variant, 91 - (variant % 3) * 7, 2, style.light);
  } else if (kit === "ash-waste") {
    line(raw, 16, 110 - (variant % 3) * 5, 92, 103 - (variant % 2) * 7, 3, style.light);
    for (const x of [28 + variant, 63, 96 - variant]) setPixel(raw, x, 107 - (x % 3), style.path);
  } else if (kit === "spring-terraces") {
    line(raw, 13, 107 - (variant % 4) * 4, 99, 99 - (variant % 3) * 5, 4, style.water);
  } else if (kit === "neutral-temperate") {
    for (const [x, y] of [[22, 104], [52 + variant, 96], [89, 108]]) disc(raw, x, y, 2, style.accent);
  } else {
    line(raw, 18, 106 - (variant % 3) * 6, 101, 98 - (variant % 2) * 5, 3, style.soil);
    for (const x of [31, 73, 104]) line(raw, x, 96, x + 2, 102, 1, style.light);
  }
}

function softenFrame(raw) {
  for (let x = 0; x < raw.width; x += 1) {
    clearPixel(raw, x, 0); clearPixel(raw, x, raw.height - 1);
  }
  for (let y = 0; y < raw.height; y += 1) {
    clearPixel(raw, 0, y); clearPixel(raw, raw.width - 1, y);
  }
  const corners = [[0, 0], [127, 0], [0, 127], [127, 127]];
  for (const [cornerX, cornerY] of corners) for (let y = 0; y < 12; y += 1) for (let x = 0; x < 12; x += 1) {
    if ((x - 11) ** 2 + (y - 11) ** 2 < 80) continue;
    clearPixel(raw, cornerX === 0 ? x : 127 - x, cornerY === 0 ? y : 127 - y);
  }
}

function outlinedLine(raw, x0, y0, x1, y1, outerWidth, innerWidth, color) {
  line(raw, x0, y0, x1, y1, outerWidth, OUTLINE);
  line(raw, x0, y0, x1, y1, innerWidth, color);
}

function freshSpringLandmark(index, style) {
  const raw = createRaw(128, 128);
  if (index === 2) {
    line(raw, 6, 104, 78, 98, 15, style.shade); line(raw, 53, 76, 121, 69, 13, style.mid);
    rect(raw, 10, 72, 62, 27, OUTLINE); rect(raw, 14, 76, 54, 19, style.light);
    rect(raw, 58, 43, 58, 25, OUTLINE); rect(raw, 62, 47, 50, 17, style.light);
    outlinedLine(raw, 74, 62, 62, 80, 9, 5, style.water);
    line(raw, 20, 82, 60, 82, 2, style.water);
  } else if (index === 3) {
    line(raw, 6, 104, 43, 98, 15, style.shade); line(raw, 85, 98, 122, 105, 15, style.shade);
    for (const origin of [10, 92]) for (let blade = 0; blade < 6; blade += 1) {
      outlinedLine(raw, origin + blade * 4, 99, origin + blade * 4 + (blade % 2 ? 2 : -2),
        41 + (blade % 3) * 8, 3, 1, style.mid);
    }
    outlinedLine(raw, 12, 101, 45, 95, 7, 3, style.shade);
    outlinedLine(raw, 84, 95, 118, 102, 7, 3, style.shade);
  } else if (index === 6) {
    for (let y = 4; y < 124; y += 1) rect(raw, 38 + ((y * 3) % 4), y, 51 - ((y * 5) % 5), 1, style.water);
    outlinedLine(raw, 35, 4, 35, 124, 5, 3, style.shade);
    outlinedLine(raw, 93, 4, 93, 124, 5, 3, style.shade);
    for (let y = 10; y < 120; y += 10) outlinedLine(raw, 39, y, 89, y, 7, 5, style.soil);
  } else {
    for (let x = 4; x < 124; x += 1) rect(raw, x, 39 + ((x * 3) % 4), 1, 49 - ((x * 5) % 5), style.water);
    outlinedLine(raw, 4, 35, 124, 35, 5, 3, style.shade);
    outlinedLine(raw, 4, 93, 124, 93, 5, 3, style.shade);
    for (let x = 10; x < 120; x += 10) outlinedLine(raw, x, 39, x, 89, 7, 5, style.soil);
  }
  softenFrame(raw);
  return raw;
}

function freshNeutralBoundary(index, style) {
  const raw = createRaw(128, 128);
  if (index === 3) {
    clumpLine(raw, 17, 24, 17, 88, OUTLINE, style.shade);
    clumpLine(raw, 111, 24, 111, 88, OUTLINE, style.shade);
    clumpLine(raw, 17, 24, 111, 24, OUTLINE, style.mid);
    for (const x of [30, 50, 77, 98]) disc(raw, x, 27, 2, style.accent);
  } else if (index === 4) {
    clumpLine(raw, 16, 30, 16, 108, OUTLINE, style.shade);
    clumpLine(raw, 16, 30, 78, 30, OUTLINE, style.mid);
    clumpLine(raw, 16, 108, 78, 108, OUTLINE, style.mid);
    for (const point of [[28, 34], [51, 28], [33, 104], [64, 110]]) disc(raw, point[0], point[1], 2, style.accent);
  } else {
    const startX = index === 5 ? 16 : index === 6 ? 102 : 20;
    const endX = index === 5 ? 47 : index === 6 ? 74 : 108;
    clumpLine(raw, startX, 24, endX, 110, OUTLINE, style.shade, 10);
    for (let flower = 0; flower < 7; flower += 1) {
      const x = Math.round(startX + ((endX - startX) * flower) / 6) + (flower % 2 ? 5 : -4);
      const y = 30 + flower * 12;
      disc(raw, x, y, 3, OUTLINE); disc(raw, x, y, 1, style.accent);
    }
  }
  softenFrame(raw);
  return raw;
}

function freshWornBoundary(index, style) {
  const raw = createRaw(128, 128);
  if (index === 3 || index === 4) {
    const openSouth = index === 3;
    outlinedLine(raw, 18, 24, 18, 89, 7, 3, style.soil);
    outlinedLine(raw, 18, 24, 91, 24, 7, 3, style.soil);
    if (openSouth) outlinedLine(raw, 102, 24, 102, 87, 7, 3, style.soil);
    else {
      outlinedLine(raw, 18, 103, 78, 103, 7, 3, style.soil);
      outlinedLine(raw, 18, 24, 18, 103, 7, 3, style.soil);
    }
    for (const [x, y, radius] of [[35, 50, 11], [54, 46, 13], [73, 53, 12], [42, 72, 12], [65, 76, 14]]) {
      disc(raw, x, y, radius, style.shade); disc(raw, x + 1, y - 2, radius - 4, style.mid);
    }
    for (const [x, y] of [[32, 42], [58, 36], [79, 48], [38, 80], [70, 83]]) {
      disc(raw, x, y, 3, OUTLINE); disc(raw, x, y, 1, style.accent);
    }
  } else if (index === 5) {
    outlinedLine(raw, 12, 104, 114, 31, 11, 7, style.soil);
    line(raw, 24, 98, 106, 39, 2, style.light);
    for (const step of [24, 45, 68, 91]) {
      const y = 111 - Math.round(step * 0.62);
      disc(raw, step, y, 5 + (step % 3), style.shade);
      line(raw, step, y + 2, step + (step % 2 ? 5 : -4), y - 7, 2, style.light);
    }
  } else if (index === 6) {
    line(raw, 4, 62, 124, 66, 17, style.shade);
    line(raw, 7, 63, 121, 67, 11, style.mid);
    line(raw, 8, 62, 120, 66, 2, style.soil);
    for (const x of [18, 44, 92, 113]) {
      disc(raw, x, 55 + (x % 5), 5, style.shade);
      line(raw, x, 58, x + 3, 49, 2, style.light);
    }
  } else {
    line(raw, 61, 4, 65, 124, 17, style.shade);
    line(raw, 62, 7, 66, 121, 11, style.mid);
    line(raw, 61, 8, 65, 120, 2, style.soil);
    for (const y of [20, 49, 84, 108]) {
      disc(raw, 55 + (y % 4), y, 5, style.shade);
      line(raw, 57, y, 48, y + 3, 2, style.light);
    }
  }
  softenFrame(raw);
  return raw;
}

function freshAshLandmark(index, style) {
  const raw = createRaw(128, 128);
  organicFootprint(raw, style, index, "ash-waste");
  if (index === 0) {
    disc(raw, 50, 66, 39, OUTLINE); disc(raw, 50, 66, 32, style.light); disc(raw, 50, 66, 21, style.shade);
    disc(raw, 42, 72, 10, style.water);
    outlinedLine(raw, 72, 70, 119, 82, 11, 7, style.mid);
    rect(raw, 31, 42, 18, 7, style.path);
  } else {
    outlinedLine(raw, 8, 84, 119, 45, 24, 18, style.light);
    outlinedLine(raw, 8, 84, 119, 45, 10, 6, style.shade);
    for (const x of [24, 54, 85]) outlinedLine(raw, x, 70, x + 4, 91, 5, 3, style.mid);
    outlinedLine(raw, 69, 65, 101, 88, 5, 3, style.accent);
    rect(raw, 101, 39, 12, 10, style.water);
  }
  softenFrame(raw);
  return raw;
}

function paintLandmarkCell(kit, index, existing, sharedBaseMask = null) {
  const style = STYLES[kit];
  if (kit === "ash-waste" && index < 2) return freshAshLandmark(index, style);
  if (kit === "spring-terraces" && [2, 3, 6, 7].includes(index)) return freshSpringLandmark(index, style);
  if (kit === "neutral-temperate" && index >= 3) return freshNeutralBoundary(index, style);
  if (kit === "worn-heartland" && index >= 3) return freshWornBoundary(index, style);
  const output = createRaw(128, 128);
  organicFootprint(output, style, index, kit);
  if (kit === "dry-scrub") alphaOverWithoutSharedBase(output, existing, sharedBaseMask);
  else alphaOver(output, existing);
  if (kit === "ash-waste") {
    outlinedLine(output, 18 + index * 3, 99, 105 - index * 2, 91, 7, 3, style.mid);
    rect(output, 96 - index * 4, 87, 3, 3, index % 2 ? style.water : style.path);
  } else if (kit === "dry-scrub") {
    line(output, 15, 105, 112, 101 - (index % 3) * 6, 4, style.shade);
    line(output, 24, 99, 105, 95 - (index % 3) * 6, 2, style.light);
  } else if (kit === "spring-terraces") {
    line(output, 16, 104, 112, 100 - (index % 2) * 8, 7, style.water);
    line(output, 24, 101, 104, 97 - (index % 2) * 8, 2, style.accent);
  } else if (kit === "neutral-temperate") {
    for (let flower = 0; flower < 5; flower += 1) disc(output, 28 + flower * 17, 103 - (flower % 2) * 8, 2,
      flower % 2 ? style.accent : style.light);
  } else {
    line(output, 16, 104, 112, 96 - (index % 2) * 7, 6, style.soil);
    line(output, 22, 101, 105, 94 - (index % 2) * 7, 2, style.light);
  }
  softenFrame(output);
  return output;
}

function assertAtlas(raw, width, height, label) {
  if (!raw || raw.width !== width || raw.height !== height || raw.channels !== 4
      || !Buffer.isBuffer(raw.data) || raw.data.length !== width * height * 4) {
    throw new TypeError(`${label}: exact RGBA master geometry required`);
  }
}

/** Return a detached exact inventory of the only cells changed by this pass. */
export function regionalR5ReauthorTargetsInternal() {
  return structuredClone(TARGETS);
}

/** Apply the deterministic A-prime raster replacements in place to trusted raw masters. */
export function applyRegionalR5AtlasReauthor(rawMasters) {
  if (!rawMasters || typeof rawMasters !== "object" || Array.isArray(rawMasters)) {
    throw new TypeError("R5 A-prime reauthor requires the raw-master record");
  }
  const changedAtlasIds = [];
  for (const [kit, targets] of Object.entries(TARGETS)) {
    const terrain = rawMasters[`${kit}-terrain`];
    const scenery = rawMasters[`${kit}-scenery`];
    const landmarks = rawMasters[`${kit}-landmarks`];
    assertAtlas(terrain, 256, 256, `${kit}-terrain`);
    assertAtlas(scenery, 512, 256, `${kit}-scenery`);
    assertAtlas(landmarks, 512, 256, `${kit}-landmarks`);
    const sharedBaseMask = kit === "dry-scrub" ? sharedOpaqueLandmarkMask(landmarks) : null;
    for (const index of targets.terrain) replaceCell(terrain, index, paintTerrainCell(kit, index));
    for (const index of targets.scenery) replaceCell(scenery, index, paintSceneryCell(kit, index));
    for (const index of targets.landmarks) {
      replaceCell(landmarks, index, paintLandmarkCell(
        kit, index, extractCell(landmarks, index, 128, 128), sharedBaseMask,
      ));
    }
    changedAtlasIds.push(`${kit}-terrain`, `${kit}-scenery`, `${kit}-landmarks`);
  }
  return Object.freeze({
    schema: "regional-r5-atlas-reauthor/v1",
    changedAtlasIds: Object.freeze(changedAtlasIds.sort()),
    targetCellCount: Object.values(TARGETS).reduce((total, targets) => (
      total + targets.terrain.length + targets.scenery.length + targets.landmarks.length
    ), 0),
  });
}
