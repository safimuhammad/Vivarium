import { useEffect, useRef, useState, type ReactElement } from "react";

export interface LiveAnnouncement {
  readonly key: string;
  readonly message: string;
}

export interface LiveAnnouncerProps {
  readonly announcement: LiveAnnouncement | null;
  readonly delayMs?: number;
  readonly onAnnounced?: (key: string) => void;
}

/** The observer shell's single deduplicated polite announcement owner. */
export function LiveAnnouncer({
  announcement,
  delayMs = 750,
  onAnnounced,
}: LiveAnnouncerProps): ReactElement {
  const [announced, setAnnounced] = useState<LiveAnnouncement | null>(null);
  const onAnnouncedRef = useRef(onAnnounced);
  onAnnouncedRef.current = onAnnounced;
  const announcementKey = announcement?.key ?? null;
  const announcementMessage = announcement?.message ?? null;
  const isBusy = announcementKey !== null && announcementMessage !== null
    && announcementKey !== announced?.key;

  useEffect(() => {
    if (announcementKey === null || announcementMessage === null
      || announcementKey === announced?.key) return undefined;
    const handle = window.setTimeout(() => {
      setAnnounced(Object.freeze({
        key: announcementKey,
        message: announcementMessage,
      }));
      onAnnouncedRef.current?.(announcementKey);
    }, delayMs);
    return () => window.clearTimeout(handle);
  }, [announced?.key, announcementKey, announcementMessage, delayMs]);

  return <div className="observer-live-announcer observer-visually-hidden"
    role="status" aria-live="polite" aria-atomic="true" aria-busy={isBusy}>
    {announced?.message ?? ""}
  </div>;
}
