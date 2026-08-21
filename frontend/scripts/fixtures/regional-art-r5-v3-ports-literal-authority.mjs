/**
 * Independent literal authority for V3 landmark edge ports and scene routes.
 *
 * Landmark spans are inclusive alpha coordinates on each 128x128 cell edge.
 * Route paths are ordered `x,y` pairs from the off-map entry toward the
 * HomeActor/yard connector. Nothing in this fixture is imported from the V3
 * builder or compositor.
 */

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const ports = (n = [], e = [], s = [], w = []) => ({ n, e, s, w });

export const REGIONAL_R5_V3_PORTS_LITERAL_AUTHORITY = deepFreeze({
  schema: "regional-r5-v3-ports-routes-literal-authority/v1",
  portReceiptApi: "regionalR5V3LandmarkPortReceipt",
  builderApi: "buildRegionalR5V3AtomicSourceMasters",
  compositorApi: "buildRegionalR5AtlasOnlyScenes",
  closedInputKeys: {
    builder: ["authority"],
    compositor: ["authoringIdentity", "masterBuffers", "placements"],
  },
  scene: {
    width: 768,
    height: 512,
    columns: 24,
    rows: 16,
    tileSize: 32,
  },
  landmarkCell: {
    width: 128,
    height: 128,
    columns: 4,
    rows: 2,
    countPerKit: 8,
  },
  edgeTouchingCount: 27,
  landmarkMasterPngSha256: {
    "worn-heartland": "3ffe17aa59c5a1be858a747af9137caf4481b67aadac7db0b50fd4c5d843a6ed",
    "spring-terraces": "f8e7e6e6f22310ac1db95324493ef5d3bb39b5d9b4864d1be23ff2f82cfd61b1",
    "dry-scrub": "ed8d75cbc64d90413d8228ac13efd4fc2211f6a73a70f2b63f4effc4cd135d0e",
    "ash-waste": "b53c379927e7ae2a49ad2302db98a6caca10de009ceb71fae8ce510422d1abea",
    "neutral-temperate": "768332e554ac37af9f4069c35865c165fc1568912d25a1fae93297295a7dc1a2",
  },
  landmarkPorts: {
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
  },
  routeEncoding: "ordered-x,y-space-separated/v1",
  routes: {
    "worn-heartland": {
      path: "0,4 1,4 2,4 3,4 4,4 5,4 6,4 6,5 6,6 6,7 7,7 8,7 9,7 10,7 11,7 11,8 11,9 11,10 11,11 11,12 11,13 12,13 13,13 14,13 15,13 16,13 17,13 18,13 19,13",
      doorTile: [19, 13],
    },
    "spring-terraces": {
      path: "0,8 1,8 2,8 3,8 4,8 5,8 6,8 7,8 8,8 8,9 8,10 8,11 9,11 10,11 11,11 12,11 13,11 14,11 14,10 14,9 14,8 14,7 14,6 15,6 16,6 17,6 18,6 18,7 18,8 18,9 18,10 18,11 18,12",
      doorTile: [18, 12],
    },
    "dry-scrub": {
      path: "23,3 22,3 21,3 20,3 19,3 18,3 18,4 18,5 18,6 17,6 16,6 15,6 14,6 13,6 12,6 12,7 12,8 12,9 13,9 14,9 15,9 16,9 17,9 18,9 19,9 20,9 20,10 20,11",
      doorTile: [20, 11],
    },
    "ash-waste": {
      path: "4,15 4,14 4,13 4,12 4,11 5,11 6,11 7,11 8,11 9,11 10,11 10,10 10,9 10,8 10,7 11,7 12,7 13,7 14,7 15,7 15,8 15,9 15,10 16,10 17,10 18,10 19,10 19,11 19,12",
      doorTile: [19, 12],
    },
    "neutral-temperate": {
      path: "8,0 8,1 8,2 8,3 8,4 7,4 6,4 5,4 5,5 5,6 5,7 5,8 6,8 7,8 8,8 9,8 10,8 11,8 12,8 12,9 12,10 12,11 12,12 12,13 13,13 14,13 15,13 16,13 17,13",
      doorTile: [17, 13],
    },
  },
});

export const REGIONAL_R5_V3_PORTS_LITERAL_AUTHORITY_SHA256 =
  "79352a23950c4376f84b76d82e88286d916fd97e098ca0ef7aed568ffded8190";
