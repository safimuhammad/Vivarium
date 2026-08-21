import { Archive, Map, ScrollText, X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import type { LivingAtlasSurface } from "./overlayState";

type OpenSurface = Exclude<LivingAtlasSurface, { kind: "closed" }>;

interface LivingAtlasChromeProps {
  surface: LivingAtlasSurface;
  hud: ReactNode;
  world: ReactNode;
  chronicle: ReactNode;
  selection: ReactNode;
  archive: ReactNode;
  archiveAvailable: boolean;
  onSurfaceIntent(kind: OpenSurface["kind"]): void;
  onOpen(surface: OpenSurface): void;
  onClose(): void;
}

interface SurfaceCopy {
  eyebrow: string;
  title: string;
  intro: string;
}

const SURFACE_ID = "living-atlas-surface";
const SURFACE_HEADING_ID = "living-atlas-surface-heading";
const MOBILE_SURFACE_QUERY = "(max-width: 700px), (max-height: 420px)";
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function surfaceCopy(surface: LivingAtlasSurface): SurfaceCopy {
  switch (surface.kind) {
    case "world":
      return {
        eyebrow: "Living atlas",
        title: "The world now",
        intro: "Read the living places without taking the world from the stage.",
      };
    case "chronicle":
      return {
        eyebrow: "Retained journey",
        title: "Chronicle",
        intro: "Observed moments remain here after their light leaves the world.",
      };
    case "selection":
      return {
        eyebrow: `Selected ${surface.selection.kind === "agent" ? "being" : surface.selection.kind}`,
        title: "Living context",
        intro: "Current truth and the trail that brought this presence here.",
      };
    case "archive":
      return {
        eyebrow: "Retained journey",
        title: "Archive",
        intro: "Read a preserved world point alongside its retained events.",
      };
    case "closed":
      return { eyebrow: "", title: "", intro: "" };
  }
}

function surfaceContent(
  surface: LivingAtlasSurface,
  content: Pick<LivingAtlasChromeProps, "world" | "chronicle" | "selection" | "archive">,
): ReactNode {
  switch (surface.kind) {
    case "world":
      return content.world;
    case "chronicle":
      return content.chronicle;
    case "selection":
      return content.selection;
    case "archive":
      return content.archive;
    case "closed":
      return null;
  }
}

export function LivingAtlasChrome({
  surface,
  hud,
  world,
  chronicle,
  selection,
  archive,
  archiveAvailable,
  onSurfaceIntent,
  onOpen,
  onClose,
}: LivingAtlasChromeProps) {
  const [isMobileSurface, setIsMobileSurface] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const previousSurfaceKindRef = useRef<LivingAtlasSurface["kind"]>("closed");
  const surfaceIsOpen = surface.kind !== "closed";
  const copy = surfaceCopy(surface);
  const activeContent = surfaceContent(surface, {
    world,
    chronicle,
    selection,
    archive,
  });

  useEffect(() => {
    const media = window.matchMedia(MOBILE_SURFACE_QUERY);
    const update = () => setIsMobileSurface(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const previousKind = previousSurfaceKindRef.current;
    previousSurfaceKindRef.current = surface.kind;
    if (surfaceIsOpen) {
      if (previousKind === "closed") {
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== document.body) {
          returnFocusRef.current = active;
        }
      }
      headingRef.current?.focus({ preventScroll: true });
      return;
    }
    if (previousKind !== "closed") {
      returnFocusRef.current?.focus({ preventScroll: true });
    }
  }, [surface.kind, surfaceIsOpen]);

  useEffect(() => {
    if (!surfaceIsOpen) {
      return undefined;
    }
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", dismissOnEscape);
    return () => document.removeEventListener("keydown", dismissOnEscape);
  }, [onClose, surfaceIsOpen]);

  function openFromTrigger(
    nextSurface: Extract<OpenSurface, { kind: "world" | "chronicle" | "archive" }>,
    trigger: HTMLButtonElement,
  ) {
    returnFocusRef.current = trigger;
    if (surface.kind === nextSurface.kind) {
      onClose();
      return;
    }
    onOpen(nextSurface);
  }

  function containMobileFocus(event: KeyboardEvent<HTMLElement>) {
    if (!isMobileSurface || event.key !== "Tab") {
      return;
    }
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) {
      event.preventDefault();
      headingRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !focusable.includes(active as HTMLElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      {hud}
      <nav className="atlas-edge-controls" aria-label="Observatory views">
        <button
          className="atlas-edge-trigger"
          type="button"
          aria-label="Open world — World Beings & land"
          aria-controls={SURFACE_ID}
          aria-expanded={surface.kind === "world" || surface.kind === "selection"}
          data-active={surface.kind === "world" || surface.kind === "selection"}
          onPointerEnter={() => onSurfaceIntent("world")}
          onFocus={() => onSurfaceIntent("world")}
          onClick={(event) => openFromTrigger({ kind: "world" }, event.currentTarget)}
        >
          <span className="atlas-edge-icon" aria-hidden="true"><Map /></span>
          <span className="atlas-edge-copy"><strong>World</strong><small>Beings &amp; land</small></span>
        </button>
        <button
          className="atlas-edge-trigger"
          type="button"
          aria-label="Open chronicle — Chronicle Living memory"
          aria-controls={SURFACE_ID}
          aria-expanded={surface.kind === "chronicle"}
          data-active={surface.kind === "chronicle"}
          onClick={(event) => openFromTrigger({ kind: "chronicle" }, event.currentTarget)}
        >
          <span className="atlas-edge-icon" aria-hidden="true"><ScrollText /></span>
          <span className="atlas-edge-copy"><strong>Chronicle</strong><small>Living memory</small></span>
        </button>
        {archiveAvailable ? (
          <button
            className="atlas-edge-trigger"
            type="button"
            aria-label="Open archive — Archive Preserved view"
            aria-controls={SURFACE_ID}
            aria-expanded={surface.kind === "archive"}
            data-active={surface.kind === "archive"}
            onClick={(event) => openFromTrigger({ kind: "archive" }, event.currentTarget)}
          >
            <span className="atlas-edge-icon" aria-hidden="true"><Archive /></span>
            <span className="atlas-edge-copy"><strong>Archive</strong><small>Preserved view</small></span>
          </button>
        ) : null}
      </nav>
      <aside
        id={SURFACE_ID}
        className="atlas-drawer"
        hidden={!surfaceIsOpen}
        role={isMobileSurface ? "dialog" : "complementary"}
        aria-modal={isMobileSurface ? true : undefined}
        aria-labelledby={surfaceIsOpen ? SURFACE_HEADING_ID : undefined}
        aria-hidden={!surfaceIsOpen}
        data-atlas-surface={surface.kind}
        data-open={String(surfaceIsOpen)}
        data-presentation={isMobileSurface ? "sheet" : "drawer"}
        onKeyDown={containMobileFocus}
      >
        {surfaceIsOpen ? (
          <>
            <header className="atlas-surface-head">
              <div>
                <span className="atlas-surface-eyebrow">{copy.eyebrow}</span>
                <h2 id={SURFACE_HEADING_ID} ref={headingRef} tabIndex={-1}>
                  {copy.title}
                </h2>
                <p>{copy.intro}</p>
              </div>
              <button
                className="atlas-surface-close"
                type="button"
                aria-label={`Close ${copy.title.toLowerCase()}`}
                onClick={onClose}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <div className="atlas-surface-content">{activeContent}</div>
          </>
        ) : null}
      </aside>
    </>
  );
}
