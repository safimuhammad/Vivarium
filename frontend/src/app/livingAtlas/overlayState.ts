export type AtlasSelection =
  | { kind: "region"; id: string }
  | { kind: "agent"; id: string }
  | { kind: "home"; id: string };

export type LivingAtlasSurface =
  | { kind: "closed" }
  | { kind: "world" }
  | { kind: "chronicle"; cursor?: number }
  | { kind: "selection"; selection: AtlasSelection }
  | { kind: "archive" };

export interface LivingAtlasOverlayState {
  surface: LivingAtlasSurface;
}

export type LivingAtlasOverlayAction =
  | {
      type: "open";
      surface: Exclude<LivingAtlasSurface, { kind: "closed" }>;
    }
  | { type: "select"; selection: AtlasSelection }
  | { type: "close" };

export function livingAtlasOverlayReducer(
  state: LivingAtlasOverlayState,
  action: LivingAtlasOverlayAction,
): LivingAtlasOverlayState {
  if (action.type === "close") {
    return { surface: { kind: "closed" } };
  }
  if (action.type === "select") {
    return { surface: { kind: "selection", selection: action.selection } };
  }
  return { surface: action.surface };
}
