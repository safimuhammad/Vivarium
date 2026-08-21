export type ObserverRendererSurfaceKind = "canvas-production" | "three-fallback";

export interface ObserverRendererSurfaceLease {
  readonly kind: ObserverRendererSurfaceKind;
  release(): void;
}

export class RendererSurfaceOwnershipError extends Error {
  readonly code = "surface-already-owned" as const;

  constructor(kind: ObserverRendererSurfaceKind, current: ObserverRendererSurfaceKind) {
    super(`Cannot install ${kind}; this surface is already owned by ${current}.`);
    this.name = "RendererSurfaceOwnershipError";
  }
}

interface SurfaceOwner {
  readonly token: object;
  readonly kind: ObserverRendererSurfaceKind;
}

const owners = new WeakMap<Element, SurfaceOwner>();

/** Claims exclusive renderer ownership of one DOM surface. */
export function claimObserverRendererSurface(
  surface: Element,
  kind: ObserverRendererSurfaceKind,
): ObserverRendererSurfaceLease {
  const current = owners.get(surface);
  if (current !== undefined) throw new RendererSurfaceOwnershipError(kind, current.kind);

  const token = Object.freeze({});
  owners.set(surface, { token, kind });
  let released = false;
  return Object.freeze({
    kind,
    release(): void {
      if (released) return;
      released = true;
      if (owners.get(surface)?.token === token) owners.delete(surface);
    },
  });
}
