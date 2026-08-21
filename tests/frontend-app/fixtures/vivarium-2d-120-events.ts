import { getChronicleManifest } from "../../../frontend/src/presentation/fixtures/chronicleCatalog";

export const VIVARIUM_2D_120_EVENTS = getChronicleManifest("C13");

export const VIVARIUM_2D_120_EVENT_RANGES = Object.freeze([
  Object.freeze({ firstCursor: 1, lastCursor: 1 }),
  Object.freeze({ firstCursor: 2, lastCursor: 120 }),
]);

