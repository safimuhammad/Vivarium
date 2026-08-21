/**
 * Which surface the root route mounts.
 *
 * The default is the **gateway** — the landing page and the configuration
 * screen — and it leads into `Vivarium2DApp`, the chronicle-validated observer.
 * Before the gateway existed the default mounted the older Living Atlas, so a
 * viewer who arrived at `/` and pressed live got the unvalidated stack. The
 * Living Atlas is still reachable, but only by asking for it by name.
 *
 * Every previously working deep link is unchanged: `?renderer=2d` and
 * `?renderer=2d-slice` mount exactly what they always did.
 */
export type RendererMode = "gateway" | "living-atlas" | "2d" | "2d-slice";

/**
 * Reads the surface out of a query string.
 *
 * @param search - `window.location.search`, or any query string.
 * @returns The named surface, or the gateway when nothing recognisable is named.
 */
export function parseRendererMode(search: string): RendererMode {
  const renderer = new URLSearchParams(search).get("renderer");
  switch (renderer) {
    case "2d":
    case "2d-slice":
    case "living-atlas":
      return renderer;
    default:
      return "gateway";
  }
}
