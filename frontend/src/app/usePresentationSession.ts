import { useEffect, useState } from "react";

import type {
  PresentationControls,
  PresentationSession,
} from "../presentation/PresentationSession";
import type { PresentedObserverFrame } from "../presentation/contracts";
import type { PresentedChronicleWindow } from "../presentation/selectors";

export interface UsePresentationSessionOptions {
  readonly createSession: () => PresentationSession;
}

export interface PresentationSessionView {
  readonly session: PresentationSession | null;
  readonly frame: PresentedObserverFrame | null;
  readonly chronicle: PresentedChronicleWindow | null;
  readonly controls: PresentationControls | null;
}

const EMPTY_VIEW: PresentationSessionView = Object.freeze({
  session: null,
  frame: null,
  chronicle: null,
  controls: null,
});

interface FactoryOwnedView {
  readonly factory: (() => PresentationSession) | null;
  readonly view: PresentationSessionView;
}

/** Owns one injected presentation session for the lifetime of its factory identity. */
export function usePresentationSession(
  options: UsePresentationSessionOptions,
): PresentationSessionView {
  const [owned, setOwned] = useState<FactoryOwnedView>({
    factory: null,
    view: EMPTY_VIEW,
  });

  useEffect(() => {
    let active = true;
    const session = options.createSession();
    const publish = (): void => {
      if (!active) return;
      try {
        const frame = session.getFrame();
        const chronicle = session.getChronicle();
        const controls = session.controls();
        if (!active) return;
        setOwned({
          factory: options.createSession,
          view: { session, frame, chronicle, controls },
        });
      } catch {
        // The direct live transport has not accepted its first exact snapshot yet.
      }
    };
    setOwned({
      factory: options.createSession,
      view: { session, frame: null, chronicle: null, controls: null },
    });
    const unsubscribe = session.subscribe(publish);
    void session.ready.then(publish, () => undefined);

    return () => {
      active = false;
      unsubscribe();
      session.dispose();
    };
  }, [options.createSession]);

  return owned.factory === options.createSession ? owned.view : EMPTY_VIEW;
}
