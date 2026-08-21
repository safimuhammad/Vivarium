export type ObserverPrimarySurface =
  | Readonly<{ kind: "closed" }>
  | Readonly<{ kind: "world" }>
  | Readonly<{ kind: "chronicle"; momentId?: string }>
  | Readonly<{ kind: "selection" }>
  | Readonly<{ kind: "archive" }>;

export interface ObserverOverlayState {
  readonly surface: ObserverPrimarySurface;
}

export type ObserverOverlayAction =
  | Readonly<{ type: "open"; surface: Exclude<ObserverPrimarySurface, { kind: "closed" }> }>
  | Readonly<{ type: "close" }>
  | Readonly<{ type: "escape" }>;

export const INITIAL_OBSERVER_OVERLAY_STATE: ObserverOverlayState = Object.freeze({
  surface: Object.freeze({ kind: "closed" }),
});

/** Reduces the shell's one mutually exclusive primary observer surface. */
export function reduceObserverOverlay(
  state: ObserverOverlayState,
  action: ObserverOverlayAction,
): ObserverOverlayState {
  if (action.type === "close" || action.type === "escape") {
    return state.surface.kind === "closed" ? state : INITIAL_OBSERVER_OVERLAY_STATE;
  }
  return Object.freeze({ surface: Object.freeze({ ...action.surface }) });
}
