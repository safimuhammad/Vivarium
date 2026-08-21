/** Source-closed V3 replacement of R5 landmark and support master cells. */

import { createHash } from "node:crypto";

import {
  snapshotRegionalR5CompositionInput,
} from "./regional-art-r5-composition-intake.mjs";

const KITS = Object.freeze([
  "worn-heartland", "spring-terraces", "dry-scrub", "ash-waste", "neutral-temperate",
]);
const FAMILIES = Object.freeze(["terrain", "scenery", "landmarks", "home-yards"]);
const AUTHORITY_SHA256 = "7fc6970ad6ab682faa737fe4b417a194c724277e7aedc2f1f59606bb32ad3e93";
const GEOMETRY = Object.freeze({
  terrain: Object.freeze([256, 256]), scenery: Object.freeze([512, 256]),
  landmarks: Object.freeze([512, 256]), "home-yards": Object.freeze([960, 160]),
});
const LANDMARKS = Object.freeze({
  "worn-heartland": Object.freeze(Array.from({ length: 8 }, (_, cell) => Object.freeze([cell, `worn:r5-landmark-${cell}`]))),
  "spring-terraces": Object.freeze(Array.from({ length: 8 }, (_, cell) => Object.freeze([cell, `spring:landmark-anatomy-${cell}`]))),
  "dry-scrub": Object.freeze(Array.from({ length: 8 }, (_, cell) => Object.freeze([cell, `dry:landmark-anatomy-${cell}`]))),
  "ash-waste": Object.freeze([
    [0, "ash:landmark-containment-basin-a"], [1, "ash:landmark-containment-basin-b"],
    [2, "ash:landmark-scrubber-a"], [3, "ash:landmark-scrubber-b"],
    [4, "ash:landmark-cask-bank-a"], [5, "ash:landmark-cask-bank-b"],
    [6, "ash:landmark-hazard-panel-a"], [7, "ash:landmark-hazard-panel-b"],
  ].map(Object.freeze)),
  "neutral-temperate": Object.freeze([
    [0, "neutral:landmark-joined-grove-a"], [1, "neutral:landmark-pond-frame-grove"],
    [2, "neutral:landmark-joined-grove-b"], [3, "neutral:landmark-stone-boundary-a"],
    [4, "neutral:landmark-stone-boundary-b"], [5, "neutral:landmark-hedgerow-verge-a"],
    [6, "neutral:landmark-hedgerow-verge-b"], [7, "neutral:landmark-hedgerow-verge-c"],
  ].map(Object.freeze)),
});

const s = (cell, role, ...sourceIds) => Object.freeze([cell, role, Object.freeze(sourceIds)]);
const SUPPORTS = Object.freeze({
  "worn-heartland": Object.freeze([
    s(4,"root-mound","r5-safe/worn-heartland/old-oak/1","r5-safe/worn-heartland/old-oak/2"),s(8,"support-tree","r5-safe/worn-heartland/old-oak/2","r5-safe/worn-heartland/old-oak/3"),
    s(3,"broken-fence-return","r5-safe/worn-heartland/fallen-fence/0","r5-safe/worn-heartland/fallen-fence/1"),s(2,"faded-flower","r5-safe/worn-heartland/faded-flower/0","r5-safe/worn-heartland/faded-flower/1"),
    s(1,"rut-stone","r5-safe/worn-heartland/worn-stone/0","r5-safe/worn-heartland/worn-stone/1"),s(6,"eroded-tuft","r5-safe/worn-heartland/faded-flower/1","r5-safe/worn-heartland/faded-flower/2"),
    s(12,"woodpile","r5-safe/worn-heartland/worn-stone/2","r5-safe/worn-heartland/worn-stone/3"),s(5,"field-stone","r5-safe/worn-heartland/worn-stone/1","r5-safe/worn-heartland/worn-stone/2"),
    s(65,"wind-root-return","r5-safe/worn-heartland/old-oak/0","r5-safe/worn-heartland/old-oak/1"),s(70,"wind-tree-return","r5-safe/worn-heartland/old-oak/2","r5-safe/worn-heartland/old-oak/3"),
    s(19,"garden-fence-return","r5-safe/worn-heartland/fallen-fence/0","r5-safe/worn-heartland/fallen-fence/1"),s(23,"garden-flower-return","r5-safe/worn-heartland/faded-flower/0","r5-safe/worn-heartland/faded-flower/1"),
    s(83,"boundary-post-return","r5-safe/worn-heartland/fallen-fence/0","r5-safe/worn-heartland/fallen-fence/1"),s(87,"boundary-stone-return","r5-safe/worn-heartland/worn-stone/0","r5-safe/worn-heartland/worn-stone/1"),
    s(85,"route-stone-return","r5-safe/worn-heartland/worn-stone/1","r5-safe/worn-heartland/worn-stone/2"),s(89,"route-flower-return","r5-safe/worn-heartland/faded-flower/2","r5-safe/worn-heartland/faded-flower/3"),
  ]),
  "spring-terraces": Object.freeze([
    s(0,"stone-bank","spring:v10-support-00"),s(4,"ripple-return","spring:v10-support-01"),s(16,"upper-lip","spring:v10-support-02"),s(20,"fall-foam","spring:v10-support-03"),
    s(64,"wet-slab","spring:v10-support-04"),s(68,"stone-riser","spring:v10-support-05"),s(7,"reed-root","spring:v10-support-06"),s(8,"silt-bank","spring:v10-support-07"),
    s(1,"root-return","spring:v10-support-08"),s(3,"hanging-reed","spring:v10-support-09"),s(69,"root-return","spring:v10-support-10"),s(73,"reed-return","spring:v10-support-11"),
    s(70,"bank-junction","spring:v10-support-12"),s(74,"stone-return","spring:v10-support-13"),s(71,"west-abutment","spring:v10-support-14"),s(75,"east-abutment","spring:v10-support-15"),
  ]),
  "dry-scrub": Object.freeze([
    s(0,"sandstone-chip","r5-safe/dry-scrub/sun-rock/0","r5-safe/dry-scrub/sun-rock/1"),s(4,"pebble-fan","r5-safe/dry-scrub/sun-rock/0","r5-safe/dry-scrub/sun-rock/1"),
    s(9,"deadwood-root","r5-safe/dry-scrub/deadwood/2","r5-safe/dry-scrub/deadwood/3"),s(11,"thorn-return","r5-safe/dry-scrub/dry-grass/2","r5-safe/dry-scrub/dry-grass/3"),
    s(2,"wind-scrub","r5-safe/dry-scrub/dry-grass/0","r5-safe/dry-scrub/dry-grass/1"),s(6,"sand-ripple","r5-safe/dry-scrub/dry-grass/1","r5-safe/dry-scrub/dry-grass/2"),
    s(8,"windbreak-stone","r5-safe/dry-scrub/sun-rock/0","r5-safe/dry-scrub/sun-rock/1"),s(5,"shade-post","r5-safe/dry-scrub/deadwood/1","r5-safe/dry-scrub/deadwood/2"),
    s(16,"ridge-stone-return","r5-safe/dry-scrub/sun-rock/0","r5-safe/dry-scrub/sun-rock/1"),s(20,"ridge-pebble-return","r5-safe/dry-scrub/sun-rock/0","r5-safe/dry-scrub/sun-rock/1"),
    s(65,"deadwood-return","r5-safe/dry-scrub/deadwood/0","r5-safe/dry-scrub/deadwood/1"),s(69,"scrub-return","r5-safe/dry-scrub/dry-grass/2","r5-safe/dry-scrub/dry-grass/3"),
    s(82,"wind-grass-return","r5-safe/dry-scrub/dry-grass/0","r5-safe/dry-scrub/dry-grass/1"),s(86,"sand-ripple-return","r5-safe/dry-scrub/dry-grass/1","r5-safe/dry-scrub/dry-grass/2"),
    s(98,"south-grass-return","r5-safe/dry-scrub/dry-grass/0","r5-safe/dry-scrub/dry-grass/1"),s(102,"south-stone-return","r5-safe/dry-scrub/sun-rock/0","r5-safe/dry-scrub/sun-rock/1"),
  ]),
  "ash-waste": Object.freeze([
    s(2,"crater-ejecta","r5-safe/ash-waste/ash-pile/0","r5-safe/ash-waste/ash-pile/1"),s(3,"coral-fissure","r5-regional/ash-waste/fracture-macro-band"),
    s(1,"snapped-insulator","ash:snapped-cross-member","ash:containment-relief"),s(0,"cable-scrap","ash:cable-run-a","ash:cable-run-b"),
    s(5,"slag-patch","r5-safe/ash-waste/slag-rock/0","r5-safe/ash-waste/slag-rock/1","r5-safe/ash-waste/slag-rock/2"),s(4,"bent-rebar","ash:bent-rebar"),
    s(7,"sealed-filter-box","ash:world-sealed-filter-box"),s(8,"collapsed-conduit","ash:service-conduit"),
    s(18,"crater-ejecta-return","r5-safe/ash-waste/ash-pile/0","r5-safe/ash-waste/ash-pile/1"),s(22,"fissure-return","r5-regional/ash-waste/fracture-macro-band"),
    s(65,"pylon-slag-return","r5-safe/ash-waste/slag-rock/0","r5-safe/ash-waste/slag-rock/1","r5-safe/ash-waste/slag-rock/2"),s(69,"pylon-cable-return","ash:cable-run-a","ash:cable-run-b"),
    s(81,"slag-stone-return","r5-safe/ash-waste/slag-rock/0","r5-safe/ash-waste/slag-rock/1","r5-safe/ash-waste/slag-rock/2"),s(85,"rebar-return","ash:bent-rebar"),
    s(96,"debris-char-return","r5-safe/ash-waste/charred-trunk/0","r5-safe/ash-waste/charred-trunk/1"),s(100,"debris-filter-return","ash:world-sealed-filter-box","r5-safe/ash-waste/ash-pile/0"),
  ]),
  "neutral-temperate": Object.freeze([
    s(3,"open-understory","r5-safe/neutral-temperate/wildflower/0","r5-safe/neutral-temperate/wildflower/1"),s(0,"secondary-tree","r5-safe/neutral-temperate/broad-tree/0","r5-safe/neutral-temperate/broad-tree/1"),
    s(9,"field-stone-return","r5-safe/neutral-temperate/field-rock/0","r5-safe/neutral-temperate/field-rock/1"),s(11,"hedgerow-return","r5-regional/neutral-temperate/plain-boundary-gap"),
    s(10,"wildflower-gap","r5-safe/neutral-temperate/wildflower/2","r5-safe/neutral-temperate/wildflower/3"),s(12,"damp-verge","r5-safe/neutral-temperate/wildflower/0","r5-safe/neutral-temperate/wildflower/1"),
    s(4,"plain-bench","neutral:v3-explicit-plain-bench"),s(6,"herb-bed","r5-safe/neutral-temperate/wildflower/1","r5-safe/neutral-temperate/wildflower/2"),
    s(16,"grove-tree-return","r5-safe/neutral-temperate/broad-tree/0","r5-safe/neutral-temperate/broad-tree/1"),s(20,"grove-understory-return","r5-safe/neutral-temperate/wildflower/0","r5-safe/neutral-temperate/wildflower/1"),
    s(65,"wall-stone-return","r5-safe/neutral-temperate/field-rock/0","r5-safe/neutral-temperate/field-rock/1"),s(69,"wall-gap-return","r5-safe/neutral-temperate/field-rock/1","r5-safe/neutral-temperate/field-rock/2"),
    s(82,"verge-flower-return","r5-safe/neutral-temperate/wildflower/0","r5-safe/neutral-temperate/wildflower/1"),s(86,"verge-herb-return","r5-safe/neutral-temperate/wildflower/1","r5-safe/neutral-temperate/wildflower/2"),
    s(98,"south-flower-return","r5-safe/neutral-temperate/wildflower/0","r5-safe/neutral-temperate/wildflower/1"),s(102,"south-stone-return","r5-safe/neutral-temperate/field-rock/0","r5-safe/neutral-temperate/field-rock/1"),
  ]),
});

const op = (cropRect, destination) => Object.freeze({
  cropRect: Object.freeze(cropRect), destination: Object.freeze(destination),
});
const SOURCE_OPERATIONS = Object.freeze({
  "ash:bent-rebar": op([16,0,32,8], [0,12]),
  "ash:cable-run-a": op([16,0,32,4], [0,12]),
  "ash:cable-run-b": op([8,0,32,4], [0,17]),
  "ash:containment-relief": op([0,0,28,28], [2,2]),
  "ash:service-conduit": op([20,0,32,10], [0,11]),
  "ash:snapped-cross-member": op([20,0,32,8], [0,11]),
  "ash:world-sealed-filter-box": op([0,0,16,16], [8,8]),
  "neutral:v3-explicit-plain-bench": op([0,0,32,26], [0,6]),
  "r5-regional/ash-waste/fracture-macro-band": op([6,3,32,32], [0,0]),
  "r5-regional/neutral-temperate/plain-boundary-gap": op([4,3,32,32], [0,0]),
  "r5-safe/ash-waste/ash-pile/0": op([0,0,32,27], [0,2]),
  "r5-safe/ash-waste/ash-pile/1": op([0,1,26,32], [3,0]),
  "r5-safe/ash-waste/charred-trunk/0": op([0,0,29,27], [1,2]),
  "r5-safe/ash-waste/charred-trunk/1": op([0,0,27,27], [2,2]),
  "r5-safe/ash-waste/slag-rock/0": op([1,0,32,31], [0,0]),
  "r5-safe/ash-waste/slag-rock/1": op([0,4,32,32], [0,0]),
  "r5-safe/ash-waste/slag-rock/2": op([1,2,32,32], [0,0]),
  "r5-safe/dry-scrub/deadwood/0": op([0,6,26,32], [3,0]),
  "r5-safe/dry-scrub/deadwood/1": op([2,7,32,32], [0,0]),
  "r5-safe/dry-scrub/deadwood/2": op([0,1,31,32], [0,0]),
  "r5-safe/dry-scrub/deadwood/3": op([0,0,26,27], [3,2]),
  "r5-safe/dry-scrub/dry-grass/0": op([0,0,23,32], [4,0]),
  "r5-safe/dry-scrub/dry-grass/1": op([0,2,29,32], [1,0]),
  "r5-safe/dry-scrub/dry-grass/2": op([0,0,32,27], [0,2]),
  "r5-safe/dry-scrub/dry-grass/3": op([0,1,27,32], [2,0]),
  "r5-safe/dry-scrub/sun-rock/0": op([2,0,32,31], [0,0]),
  "r5-safe/dry-scrub/sun-rock/1": op([0,0,19,20], [6,6]),
  "r5-safe/neutral-temperate/broad-tree/0": op([0,0,30,30], [1,1]),
  "r5-safe/neutral-temperate/broad-tree/1": op([1,3,32,32], [0,0]),
  "r5-safe/neutral-temperate/field-rock/0": op([0,0,32,28], [0,2]),
  "r5-safe/neutral-temperate/field-rock/1": op([0,0,19,19], [6,6]),
  "r5-safe/neutral-temperate/field-rock/2": op([0,0,27,26], [2,3]),
  "r5-safe/neutral-temperate/wildflower/0": op([0,0,22,31], [5,0]),
  "r5-safe/neutral-temperate/wildflower/1": op([0,0,19,24], [6,4]),
  "r5-safe/neutral-temperate/wildflower/2": op([0,0,20,24], [6,4]),
  "r5-safe/neutral-temperate/wildflower/3": op([0,0,27,27], [2,2]),
  "r5-safe/worn-heartland/faded-flower/0": op([0,0,23,31], [4,0]),
  "r5-safe/worn-heartland/faded-flower/1": op([0,0,20,25], [6,3]),
  "r5-safe/worn-heartland/faded-flower/2": op([0,0,19,23], [6,4]),
  "r5-safe/worn-heartland/faded-flower/3": op([0,0,16,19], [8,6]),
  "r5-safe/worn-heartland/fallen-fence/0": op([9,0,32,26], [0,3]),
  "r5-safe/worn-heartland/fallen-fence/1": op([0,0,20,25], [6,3]),
  "r5-safe/worn-heartland/old-oak/0": op([0,3,32,32], [0,0]),
  "r5-safe/worn-heartland/old-oak/1": op([0,0,30,30], [1,1]),
  "r5-safe/worn-heartland/old-oak/2": op([0,2,32,32], [0,0]),
  "r5-safe/worn-heartland/old-oak/3": op([0,0,30,31], [1,0]),
  "r5-safe/worn-heartland/worn-stone/0": op([1,0,32,30], [0,1]),
  "r5-safe/worn-heartland/worn-stone/1": op([0,0,20,20], [6,6]),
  "r5-safe/worn-heartland/worn-stone/2": op([0,0,28,27], [2,2]),
  "r5-safe/worn-heartland/worn-stone/3": op([0,0,22,24], [5,4]),
  ...Object.fromEntries(Array.from({ length: 16 }, (_, index) => {
    const size = [36,24,28,36,40,40,28,36,40,24,36,28,28,40,36,28][index];
    const cropInset = Math.max(0, Math.floor((size - 32) / 2));
    const cropSize = Math.min(32, size);
    const destinationInset = Math.floor((32 - cropSize) / 2);
    return [`spring:v10-support-${String(index).padStart(2, "0")}`,
      op([cropInset,cropInset,cropSize,cropSize], [destinationInset,destinationInset])];
  })),
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort(compareText).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const canonicalDigest = (value) => sha256(Buffer.from(canonicalJson(value)));

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const ports = (n = [], e = [], s = [], w = []) => ({ n, e, s, w });
const LANDMARK_EDGE_PORTS = deepFreeze({
  "worn-heartland": [
    [0, ports([], [[36, 74], [124, 127]], [[5, 127]], [[39, 65]])],
    [1, ports([[43, 43]], [[25, 61]], [[20, 114]], [[31, 47]])],
    [2, ports([], [[12, 50]], [[0, 81]], [[124, 127]])],
    [3, ports()],
    [4, ports([], [[50, 56]])],
    [5, ports([], [[21, 127]], [[0, 127]], [[93, 127]])],
    [6, ports([], [[19, 107]], [], [[29, 98]])],
    [7, ports([[24, 103]], [], [[19, 96]])],
  ],
  "spring-terraces": [
    [0, ports([[22, 57]], [], [], [[38, 69], [72, 72], [101, 101], [104, 104]])],
    [1, ports()],
    [2, ports([], [], [], [[77, 91]])],
    [3, ports([], [[85, 107]], [], [[83, 108]])],
    [4, ports()],
    [5, ports([[50, 59], [76, 86]], [[99, 127]], [[0, 127]], [[113, 127]])],
    [6, ports([[35, 86]], [[69, 89]], [[37, 82]], [[33, 51]])],
    [7, ports([[35, 91], [111, 127]], [[0, 127]], [[32, 94], [112, 127]], [[28, 87]])],
  ],
  "dry-scrub": [
    [0, ports()], [1, ports()], [2, ports()], [3, ports()],
    [4, ports()], [5, ports()], [6, ports()], [7, ports()],
  ],
  "ash-waste": [
    [0, ports([], [[103, 113]], [], [[110, 120]])],
    [1, ports([], [[105, 115]], [[20, 33]], [[109, 117]])],
    [2, ports([[32, 37]], [[116, 118]], [], [[107, 115]])],
    [3, ports([], [[109, 119]], [], [[104, 114]])],
    [4, ports([], [[111, 121]], [], [[103, 111]])],
    [5, ports([], [[112, 124]], [], [[101, 109]])],
    [6, ports([], [[115, 125]], [[117, 117], [123, 123]], [[98, 108]])],
    [7, ports([], [[117, 127]], [[108, 127]], [[97, 105]])],
  ],
  "neutral-temperate": [
    [0, ports([], [[61, 83], [98, 114]], [], [[60, 74], [107, 123]])],
    [1, ports([], [[65, 65], [103, 119]], [], [[27, 49], [108, 122]])],
    [2, ports([], [[98, 114]], [], [[39, 43], [106, 123]])],
    [3, ports([], [], [], [[43, 80], [87, 103]])],
    [4, ports([], [[79, 92]], [], [[44, 73]])],
    [5, ports()],
    [6, ports()],
    [7, ports([], [[101, 117]], [], [[41, 79]])],
  ],
});
const LANDMARK_MASTER_PNG_SHA256 = deepFreeze({
  "worn-heartland": "3ffe17aa59c5a1be858a747af9137caf4481b67aadac7db0b50fd4c5d843a6ed",
  "spring-terraces": "f8e7e6e6f22310ac1db95324493ef5d3bb39b5d9b4864d1be23ff2f82cfd61b1",
  "dry-scrub": "ed8d75cbc64d90413d8228ac13efd4fc2211f6a73a70f2b63f4effc4cd135d0e",
  "ash-waste": "b53c379927e7ae2a49ad2302db98a6caca10de009ceb71fae8ce510422d1abea",
  "neutral-temperate": "768332e554ac37af9f4069c35865c165fc1568912d25a1fae93297295a7dc1a2",
});
const LANDMARK_PORT_RECEIPT_BODY = deepFreeze({
  schema: "regional-r5-v3-landmark-port-receipt/v1",
  masterPngSha256: LANDMARK_MASTER_PNG_SHA256,
  edgeTouchingCount: 27,
  cells: KITS.flatMap((kit) => LANDMARK_EDGE_PORTS[kit]
    .map(([cellIndex, edgeAlphaSpans]) => ({ kit, cell: cellIndex, edgeAlphaSpans }))),
});
const LANDMARK_PORT_RECEIPT = deepFreeze({
  ...LANDMARK_PORT_RECEIPT_BODY,
  canonicalSha256: canonicalDigest(LANDMARK_PORT_RECEIPT_BODY),
});

/** Return a detached immutable receipt for the V3 landmark edge ports. */
export function regionalR5V3LandmarkPortReceiptInternal() {
  return deepFreeze(structuredClone(LANDMARK_PORT_RECEIPT));
}

function assertRawGeometry(raw, width, height, label) {
  if (!raw || raw.width !== width || raw.height !== height || raw.channels !== 4
      || !Buffer.isBuffer(raw.data) || raw.data.length !== width * height * 4) {
    throw new TypeError(`${label}: exact RGBA geometry required`);
  }
}

function assertRaw(raw, width, height, label) {
  assertRawGeometry(raw, width, height, label);
  for (let offset = 0; offset < raw.data.length; offset += 4) {
    const alpha = raw.data[offset + 3];
    if (alpha !== 0 && alpha !== 255) throw new Error(`${label}: binary alpha required`);
    if (alpha === 0 && (raw.data[offset] !== 0 || raw.data[offset + 1] !== 0 || raw.data[offset + 2] !== 0)) {
      throw new Error(`${label}: transparent RGB must be zero`);
    }
  }
}

function cloneRaw(raw) {
  return { data: Buffer.from(raw.data), width: raw.width, height: raw.height, channels: 4 };
}

function crop(raw, x, y, width, height) {
  if (![x, y, width, height].every(Number.isSafeInteger) || x < 0 || y < 0
      || width <= 0 || height <= 0 || x + width > raw.width || y + height > raw.height) {
    throw new RangeError("V3 atomic integer crop is outside its source");
  }
  const output = { data: Buffer.alloc(width * height * 4), width, height, channels: 4 };
  for (let row = 0; row < height; row += 1) {
    raw.data.copy(output.data, row * width * 4, ((y + row) * raw.width + x) * 4,
      ((y + row) * raw.width + x + width) * 4);
  }
  return output;
}

function alphaOver(destination, source, x, y) {
  for (let sy = 0; sy < source.height; sy += 1) for (let sx = 0; sx < source.width; sx += 1) {
    const sourceOffset = (sy * source.width + sx) * 4;
    if (source.data[sourceOffset + 3] === 0) continue;
    const dx = x + sx; const dy = y + sy;
    if (dx < 0 || dy < 0 || dx >= destination.width || dy >= destination.height) continue;
    source.data.copy(destination.data, (dy * destination.width + dx) * 4, sourceOffset, sourceOffset + 4);
  }
}

function cell(raw, index, width, height) {
  const columns = raw.width / width;
  return crop(raw, (index % columns) * width, Math.floor(index / columns) * height, width, height);
}

function replaceCell(raw, index, source) {
  const columns = raw.width / source.width;
  const left = (index % columns) * source.width;
  const top = Math.floor(index / columns) * source.height;
  for (let row = 0; row < source.height; row += 1) {
    source.data.copy(raw.data, ((top + row) * raw.width + left) * 4, row * source.width * 4,
      (row + 1) * source.width * 4);
  }
}

function sourcePlacement(sourceId, source, role) {
  const operation = role === "fissure-return" && sourceId === "r5-regional/ash-waste/fracture-macro-band"
    ? op([0,3,32,32], [0,0]) : SOURCE_OPERATIONS[sourceId];
  if (!operation) throw new Error(`${sourceId}: V3 atomic operation authority missing`);
  const [x, y, width, height] = operation.cropRect;
  const prepared = crop(source, x, y, width, height);
  return { prepared, x: operation.destination[0], y: operation.destination[1] };
}

function composeSupport(sourceIds, sources, role) {
  const output = { data: Buffer.alloc(32 * 32 * 4), width: 32, height: 32, channels: 4 };
  const sourceOperations = [];
  const sourceHashes = [];
  for (const sourceId of sourceIds) {
    const source = sources.get(sourceId);
    if (!source) throw new Error(`${sourceId}: V3 atomic source missing`);
    assertRaw(source, source.width, source.height, sourceId);
    const sourceRgbaSha256 = sha256(source.data);
    const placement = sourcePlacement(sourceId, source, role);
    sourceOperations.push(Object.freeze({
      sourceId,
      sourceRgbaSha256,
      cropRect: Object.freeze([...((role === "fissure-return"
        && sourceId === "r5-regional/ash-waste/fracture-macro-band")
        ? [0,3,32,32] : SOURCE_OPERATIONS[sourceId].cropRect)]),
      destination: Object.freeze([placement.x, placement.y]),
    }));
    sourceHashes.push([sourceId, sourceRgbaSha256]);
    alphaOver(output, placement.prepared, placement.x, placement.y);
  }
  return { raw: output, sourceOperations, sourceRgbaSha256: canonicalDigest(sourceHashes) };
}

function sourceMapMatches(authority) {
  for (const kit of KITS) {
    if (canonicalJson(authority.landmarks?.[kit]) !== canonicalJson(LANDMARKS[kit])) return false;
    const actual = authority.supportPlacements?.[kit]?.map(([cellIndex, _x, _y, role, sourceIds]) => [cellIndex, role, sourceIds]);
    if (canonicalJson(actual) !== canonicalJson(SUPPORTS[kit])) return false;
  }
  return true;
}

/** Build cloned V3 masters from internally trusted atomic source raws. */
export async function buildRegionalR5V3AtomicSourceMastersInternal(inputArguments) {
  const snapshot = snapshotRegionalR5CompositionInput(inputArguments);
  return (async () => {
    const {
      input, rawMasters, fragments, patches, explicitSources, basePlacements, cellLayersByAtlas,
      reauthorReceipt, encodeRaw,
    } = snapshot;
  const inputKeys = input && typeof input === "object" && !Array.isArray(input)
    ? Reflect.ownKeys(input) : [];
  if (!input || typeof input !== "object" || Array.isArray(input)
      || inputKeys.some((key) => typeof key !== "string")
      || canonicalJson(inputKeys.sort(compareText)) !== canonicalJson(["authority"])) {
    throw new TypeError("V3 atomic source builder is closed to only authority input; scene data is forbidden");
  }
  const authority = input.authority;
  if (canonicalDigest(authority) !== AUTHORITY_SHA256 || !sourceMapMatches(authority)) {
    throw new Error("V3 atomic source authority is missing, extra, or altered");
  }
  if (!(fragments instanceof Map) || !(patches instanceof Map) || !(explicitSources instanceof Map)
      || typeof encodeRaw !== "function") throw new TypeError("V3 atomic trusted source inventory missing");
  for (const [inventoryName, inventory] of [
    ["fragments", fragments],
    ["patches", patches],
    ["explicitSources", explicitSources],
  ]) {
    for (const [sourceId, raw] of inventory) {
      assertRawGeometry(raw, raw?.width, raw?.height, `${inventoryName}/${sourceId}`);
    }
  }
  const sources = new Map([...fragments, ...patches, ...explicitSources]);
  const masters = {};
  for (const kit of KITS) for (const family of FAMILIES) {
    const atlasId = `${kit}-${family}`; const [width, height] = GEOMETRY[family];
    assertRaw(rawMasters?.[atlasId], width, height, atlasId);
    masters[atlasId] = cloneRaw(rawMasters[atlasId]);
  }
  if (!(cellLayersByAtlas instanceof Map)) throw new TypeError("V3 atomic cell-layer provenance missing");
  for (const [cellKey, layers] of cellLayersByAtlas) {
    if (!Array.isArray(layers)) {
      throw new TypeError(`${cellKey}: V3 atomic cell-layer history must be an Array`);
    }
    for (const [layerIndex, layer] of layers.entries()) {
      const raw = layer?.raw;
      assertRawGeometry(raw, raw?.width, raw?.height, `${cellKey}/${layerIndex}`);
    }
  }
  const finalLayers = new Map(cellLayersByAtlas);
  const reauthorHistory = new Map((reauthorReceipt?.cells ?? []).map((entry) => [
    `${entry.atlasId}:${entry.cell}`,
    Object.freeze({ schema: reauthorReceipt.schema, beforeRgbaSha256: entry.beforeRgbaSha256,
      afterRgbaSha256: entry.afterRgbaSha256, supersededBlindRepairId: entry.supersededBlindRepairId }),
  ]));
  const cells = [];
  const replacements = [];
  for (const kit of KITS) {
    for (const [cellIndex, sourceId] of LANDMARKS[kit]) {
      const atlasId = `${kit}-landmarks`; const source = sources.get(sourceId);
      assertRaw(source, 128, 128, sourceId);
      replacements.push({ atlasId, cellIndex, family: "landmarks", sourceKind: "atomic-landmark",
        sourceIds: [sourceId], raw: cloneRaw(source), sourceRgbaSha256: sha256(source.data),
        sourceOperations: [{ sourceId, sourceRgbaSha256: sha256(source.data),
          cropRect: [0,0,128,128], destination: [0,0] }],
        orderedOperations: ["alpha-over"] });
    }
    for (const [cellIndex, role, sourceIds] of SUPPORTS[kit]) {
      const composed = composeSupport(sourceIds, sources, role);
      replacements.push({ atlasId: `${kit}-scenery`, cellIndex, family: "scenery",
        sourceKind: "ordered-atomic-stack", sourceIds: [...sourceIds], raw: composed.raw,
        sourceRgbaSha256: composed.sourceRgbaSha256, sourceOperations: composed.sourceOperations,
        orderedOperations: ["palette-normalization", "integer-crop", "transparent-padding", "integer-translation", "alpha-over"] });
    }
  }
  for (const replacement of replacements) {
    const size = replacement.family === "landmarks" ? 128 : 32;
    const prior = cell(masters[replacement.atlasId], replacement.cellIndex, size, size);
    replaceCell(masters[replacement.atlasId], replacement.cellIndex, replacement.raw);
    const after = cell(masters[replacement.atlasId], replacement.cellIndex, size, size);
    if (sha256(prior.data) === sha256(after.data)) throw new Error(`${replacement.atlasId}:${replacement.cellIndex}: V3 replacement made no pixel change`);
    const key = `${replacement.atlasId}:${replacement.cellIndex}`;
    const supersededLayers = finalLayers.get(key) ?? [];
    finalLayers.set(key, [Object.freeze({
      id: `r5-v3-layer/${replacement.atlasId}/${String(replacement.cellIndex).padStart(3, "0")}`,
      z: 0,
      kind: replacement.sourceKind,
      sourceId: replacement.sourceIds.join("+"),
      role: replacement.family === "landmarks" ? "landmark-anatomy" : "scenery-fragment",
      raw: after,
    })]);
    cells.push({ ...replacement, beforeRgbaSha256: sha256(prior.data),
      afterRgbaSha256: sha256(after.data),
      supersededHistory: [
        ...supersededLayers.map((layer) => Object.freeze({ id: layer.id, kind: layer.kind,
          sourceId: layer.sourceId, role: layer.role, rgbaSha256: sha256(layer.raw.data) })),
        ...(reauthorHistory.has(key) ? [reauthorHistory.get(key)] : []),
      ],
    });
  }
  const masterBuffers = {};
  const masterPngSha256 = {};
  for (const atlasId of Object.keys(masters).sort(compareText)) {
    masterBuffers[atlasId] = Buffer.from(await encodeRaw(masters[atlasId]));
    masterPngSha256[atlasId] = sha256(masterBuffers[atlasId]);
  }
  const cellReceipts = cells.map(({ raw: _raw, cellIndex, ...entry }) => Object.freeze({
    atlasId: entry.atlasId, cell: cellIndex, family: entry.family, sourceKind: entry.sourceKind,
    sourceIds: Object.freeze(entry.sourceIds), beforeRgbaSha256: entry.beforeRgbaSha256,
    sourceRgbaSha256: entry.sourceRgbaSha256,
    sourceOperations: deepFreeze(structuredClone(entry.sourceOperations)),
    orderedOperations: Object.freeze(entry.orderedOperations),
    afterRgbaSha256: entry.afterRgbaSha256, encodedMasterPngSha256: masterPngSha256[entry.atlasId],
    supersededHistory: Object.freeze(entry.supersededHistory),
  }));
  const supportPlacements = KITS.flatMap((kit) => {
    const base = basePlacements.scenes[kit].visibleStaticLayers
      .filter(({ id }) => id.includes("/support/"));
    return SUPPORTS[kit].map(([cellIndex, role, sourceIds], index) => {
      const placement = base[index];
      if (!placement || placement.role !== role) {
        throw new Error(`${kit}/${role}: V3 support placement missing or reordered`);
      }
      const result = cell(masters[`${kit}-scenery`], cellIndex, 32, 32);
      return Object.freeze({ kit, role, sceneX: placement.destination.x, sceneY: placement.destination.y,
        cell: cellIndex, sourceIds: Object.freeze([...sourceIds]), resultRgbaSha256: sha256(result.data) });
    });
  });
  const placementBody = {
    schema: "regional-r5-v3-atlas-only-placement-authority/v1",
    scenes: Object.fromEntries(KITS.map((kit) => {
      const scene = basePlacements.scenes[kit];
      const supportCells = SUPPORTS[kit];
      let supportIndex = 0;
      const visibleStaticLayers = scene.visibleStaticLayers.map((layer) => {
        if (!layer.id.includes("/support/")) return structuredClone(layer);
        const [cellIndex, role] = supportCells[supportIndex];
        supportIndex += 1;
        if (layer.role !== role) throw new Error(`${kit}/${role}: V3 support placement order drift`);
        return { ...structuredClone(layer), cell: cellIndex };
      });
      if (supportIndex !== 16) throw new Error(`${kit}: exact sixteen V3 support placements required`);
      return [kit, { kit, visibleStaticLayers, identities: structuredClone(scene.identities) }];
    })),
  };
  const placements = deepFreeze({ ...placementBody, canonicalSha256: canonicalDigest(placementBody) });
  const receiptBody = { schema: "regional-r5-v3-atomic-source-receipt/v1",
    authoritySha256: AUTHORITY_SHA256, masterPngSha256: Object.freeze(masterPngSha256),
    landmarkPortReceiptSha256: LANDMARK_PORT_RECEIPT.canonicalSha256,
    cells: Object.freeze(cellReceipts), supportPlacements: Object.freeze(supportPlacements) };
  const receipt = deepFreeze({ ...receiptBody, canonicalSha256: canonicalDigest(receiptBody) });
  const authoringIdentityBody = {
    schema: "regional-r5-v3-authoring-identity/v1",
    authoritySha256: AUTHORITY_SHA256,
    receiptSha256: receipt.canonicalSha256,
    landmarkPortReceiptSha256: LANDMARK_PORT_RECEIPT.canonicalSha256,
    masterSetSha256: canonicalDigest(masterPngSha256),
    placementSha256: placements.canonicalSha256,
  };
  const authoringIdentity = deepFreeze({
    ...authoringIdentityBody,
    canonicalSha256: canonicalDigest(authoringIdentityBody),
  });
  const result = Object.freeze({
    schema: "regional-r5-v3-atomic-source-masters/v1",
    authority: deepFreeze(structuredClone(authority)),
    masterBuffers: Object.freeze(masterBuffers),
    placements,
    authoringIdentity,
    receipt,
  });
    return Object.freeze({ result, rawMasters: masters, cellLayersByAtlas: finalLayers });
  })();
}
