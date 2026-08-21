#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import {
  ARTIFACT_SCHEMA_VERSION,
  RECORDING_FPS,
  canonicalJson,
  readNormalizedJson,
  sha256Buffer,
  validateMarkerDocument,
  writeNormalizedJson,
} from "./recording-artifacts.mjs";

const CELL_WIDTH = 480;
const CELL_HEIGHT = 356;
const IMAGE_WIDTH = 456;
const IMAGE_HEIGHT = 270;
const LABEL_HEIGHT = 62;
const COLUMNS = 2;
const BACKGROUND = "#101813";

export async function buildChronicleContactSheet(chronicleDirectory) {
  const chronicleId = path.basename(chronicleDirectory);
  if (!/^C(?:0[0-9]|1[0-7])$/.test(chronicleId)) throw new Error(`invalid Chronicle directory ${chronicleId}`);
  const cells = [];
  for (const viewport of ["desktop", "mobile"]) {
    const directory = path.join(chronicleDirectory, viewport);
    const markers = await readNormalizedJson(path.join(directory, "markers.json"));
    const frameCount = await readFrameCount(directory, markers);
    await validateMarkerDocument(markers, { directory, frameCount, fps: RECORDING_FPS });
    for (const marker of [...markers.observed].sort(compareMarkers)) {
      const sourcePath = path.join(directory, marker.still.file);
      const source = await readFile(sourcePath);
      const image = await sharp(source)
        .resize(IMAGE_WIDTH, IMAGE_HEIGHT, { fit: "contain", kernel: "nearest", background: BACKGROUND })
        .png({ compressionLevel: 9, adaptiveFiltering: false })
        .toBuffer();
      cells.push({ viewport, marker, source, image });
    }
  }
  if (cells.length === 0) throw new Error(`${chronicleId} has no marker stills`);
  const rows = Math.ceil(cells.length / COLUMNS);
  const width = COLUMNS * CELL_WIDTH;
  const height = rows * CELL_HEIGHT;
  const composites = [];
  const metadataCells = [];
  for (const [index, cell] of cells.entries()) {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const left = column * CELL_WIDTH;
    const top = row * CELL_HEIGHT;
    const label = `${chronicleId} · ${cell.viewport.toUpperCase()} · ${cell.marker.label}`;
    composites.push({ input: labelSvg(CELL_WIDTH, LABEL_HEIGHT, label, cell.marker.frameIndex, cell.marker.mediaTimeMs), left, top });
    composites.push({ input: cell.image, left: left + 12, top: top + LABEL_HEIGHT + 12 });
    metadataCells.push({
      markerId: cell.marker.id,
      label,
      viewport: cell.viewport,
      frameIndex: cell.marker.frameIndex,
      mediaTimeMs: cell.marker.mediaTimeMs,
      source: {
        file: `${cell.viewport}/${cell.marker.still.file}`,
        bytes: cell.source.length,
        sha256: sha256Buffer(cell.source),
      },
      rect: { x: left, y: top, width: CELL_WIDTH, height: CELL_HEIGHT },
    });
  }
  const sheet = await sharp({ create: { width, height, channels: 4, background: BACKGROUND } })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
  const imagePath = path.join(chronicleDirectory, "contact-sheet.png");
  const sidecarPath = path.join(chronicleDirectory, "contact-sheet.json");
  await writeFile(imagePath, sheet);
  await writeNormalizedJson(sidecarPath, {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    chronicleId,
    construction: "Sharp deterministic labeled marker grid",
    image: { file: "contact-sheet.png", bytes: sheet.length, sha256: sha256Buffer(sheet), width, height },
    cells: metadataCells,
  });
  return { imagePath, sidecarPath };
}

async function readFrameCount(directory, markers) {
  try {
    const recording = await readNormalizedJson(path.join(directory, "recording.json"));
    return recording.frameCount;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return Math.max(1, ...markers.observed.map((marker) => marker.frameIndex + 1));
  }
}

function compareMarkers(left, right) {
  return left.frameIndex - right.frameIndex || left.id.localeCompare(right.id);
}

function labelSvg(width, height, label, frameIndex, mediaTimeMs) {
  const title = escapeXml(label);
  const timing = escapeXml(`frame ${frameIndex} · ${formatTime(mediaTimeMs)} ms`);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#243126"/>
    <rect x="0" y="${height - 3}" width="100%" height="3" fill="#d4aa55"/>
    <text x="14" y="25" fill="#fff4d6" font-family="Arial, sans-serif" font-size="15" font-weight="700">${title}</text>
    <text x="14" y="47" fill="#c9d4c8" font-family="Arial, sans-serif" font-size="12">${timing}</text>
  </svg>`);
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]);
}

function formatTime(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

async function main(argv) {
  const inputIndex = argv.indexOf("--input");
  if (inputIndex < 0 || !argv[inputIndex + 1]) throw new Error("usage: build-2d-chronicle-contact-sheets.mjs --input <directory>");
  const root = path.resolve(argv[inputIndex + 1]);
  const directories = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^C(?:0[0-9]|1[0-7])$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const directory of directories) await buildChronicleContactSheet(path.join(root, directory));
  const catalogIndex = argv.indexOf("--catalog");
  const catalogPath = catalogIndex < 0 ? undefined : argv[catalogIndex + 1];
  const { sealEvidenceTree } = await import("./record-2d-chronicles.mjs");
  await sealEvidenceTree(root, catalogPath ? { catalogPath } : {});
  process.stdout.write(`${canonicalJson({ built: directories })}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
